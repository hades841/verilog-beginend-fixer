import { promises as fs } from 'fs';
import * as path from 'path';

export interface PackageOptions {
    searchRoots?: readonly string[];
    packageFiles?: readonly string[];
}

export interface PackageCompilation {
    files: string[];
    includeDirectories: string[];
    unresolved: string[];
}

// 保留字符串以读取 include 路径，屏蔽注释中的伪指令和包名称。
function withoutComments(text: string): string {
    return text.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
        token => token.startsWith('"') ? token : token.replace(/[^\r\n]/g, ' '));
}

function packageNames(text: string): string[] {
    return [...text.matchAll(/\bpackage\s+(?:(?:automatic|static)\s+)?([a-zA-Z_]\w*)\s*;/g)].map(match => match[1]);
}

function fileKey(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** 只收集实际引用的包，按依赖顺序放在候选文件之前交给 xvlog。 */
export async function collectPackageFiles(
    sourcePath: string,
    candidateText: string,
    includePaths: readonly string[],
    options: PackageOptions = {}
): Promise<PackageCompilation> {
    const includeDirectories = [...includePaths];
    const addDirectory = (directory: string) => {
        if (!includeDirectories.some(item => fileKey(item) === fileKey(directory))) {
            includeDirectories.push(path.resolve(directory));
        }
    };
    // 展开 include 仅用于发现包依赖；真正的预处理和语义检查仍由 xvlog 完成。
    const readUnit = async (file: string, text: string, stack = new Set<string>()): Promise<string> => {
        const key = fileKey(file);
        if (stack.has(key)) return '';
        const nextStack = new Set(stack).add(key);
        const clean = withoutComments(text);
        let expanded = '';
        let offset = 0;
        for (const match of clean.matchAll(/`include\s+"([^"]+)"/g)) {
            expanded += clean.slice(offset, match.index);
            offset = match.index! + match[0].length;
            const fileName = match[1].replace(/[\\/]/g, path.sep);
            for (const directory of [path.dirname(file), ...includeDirectories]) {
                const includedPath = path.resolve(directory, fileName);
                let includedText: string;
                try { includedText = await fs.readFile(includedPath, 'utf8'); }
                catch { continue; } // 无法找到的 include 仍由 xvlog 报告。
                addDirectory(path.dirname(includedPath));
                expanded += await readUnit(includedPath, includedText, nextStack);
                break;
            }
        }
        return (expanded + clean.slice(offset)).replace(/"(?:\\.|[^"\\])*"/g, '');
    };
    const references = (text: string) => [...new Set(
        [...text.matchAll(/\b([a-zA-Z_]\w*)\s*::/g)].map(match => match[1])
    )];
    const candidateUnit = await readUnit(sourcePath, candidateText);
    const localNames = new Set(packageNames(candidateUnit));
    const requested = references(candidateUnit).filter(name => !localNames.has(name));
    const explicitFiles = [...new Set((options.packageFiles ?? []).map(file => path.resolve(file)))];
    const result: PackageCompilation = { files: [], includeDirectories, unresolved: [] };
    if (!requested.length && !explicitFiles.length) return result;

    const providers = new Map<string, string[]>();
    const texts = new Map<string, string>();
    const addProvider = (name: string, file: string) => {
        const files = providers.get(name) ?? [];
        if (!files.some(item => fileKey(item) === fileKey(file))) files.push(file);
        providers.set(name, files);
    };
    const scanned = new Set<string>();
    const ignored = new Set(['.git', 'node_modules', '.verilog-helper-logs', '.xil', 'xsim.dir']);
    const scan = async (directory: string): Promise<void> => {
        const key = fileKey(directory);
        if (scanned.has(key)) return;
        scanned.add(key);
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); }
        catch { return; }
        for (const entry of entries) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && !ignored.has(entry.name.toLowerCase())) await scan(file);
            if (!entry.isFile() || !/\.(?:sv|v|svh|vh)$/i.test(entry.name) || fileKey(file) === fileKey(sourcePath)) continue;
            const text = await fs.readFile(file, 'utf8');
            const names = packageNames(withoutComments(text).replace(/"(?:\\.|[^"\\])*"/g, ''));
            if (!names.length) continue;
            texts.set(fileKey(file), text);
            for (const name of names) addProvider(name, file);
        }
    };
    for (const directory of [path.dirname(sourcePath), ...(options.searchRoots ?? []), ...includePaths, ...explicitFiles.map(file => path.dirname(file))]) await scan(directory);

    // 显式配置优先，允许在多个工程副本包含同名包时指定正确文件。
    const explicitProviders = new Map<string, string>();
    const units = new Map<string, string>();
    const loadUnit = async (file: string): Promise<string> => {
        const key = fileKey(file);
        let unit = units.get(key);
        if (unit === undefined) {
            addDirectory(path.dirname(file));
            unit = await readUnit(file, texts.get(key) ?? await fs.readFile(file, 'utf8'));
            units.set(key, unit);
        }
        return unit;
    };
    for (const file of explicitFiles) {
        if (fileKey(file) === fileKey(sourcePath)) continue;
        for (const name of packageNames(await loadUnit(file))) {
            if (explicitProviders.has(name) && fileKey(explicitProviders.get(name)!) !== fileKey(file)) {
                throw new Error(`包 ${name} 配置了多个定义文件，请检查 vivadoPackageFiles。`);
            }
            explicitProviders.set(name, file);
        }
    }
    const completed = new Set<string>();
    const visiting = new Set<string>();
    const visitPackage = async (name: string): Promise<void> => {
        if (localNames.has(name)) return;
        const matches = providers.get(name) ?? [];
        const file = explicitProviders.get(name) ?? (matches.length === 1 ? matches[0] : undefined);
        if (!file) {
            if (matches.length > 1) throw new Error(`包 ${name} 存在多个定义：${matches.join('; ')}。请通过 vivadoPackageFiles 指定文件。`);
            if (!result.unresolved.includes(name)) result.unresolved.push(name);
            return;
        }
        await visitFile(file);
    };
    const visitFile = async (file: string): Promise<void> => {
        const key = fileKey(file);
        if (key === fileKey(sourcePath) || completed.has(key)) return;
        if (visiting.has(key)) throw new Error(`包依赖存在循环：${file}`);
        visiting.add(key);
        const unit = await loadUnit(file);
        const ownNames = new Set(packageNames(unit));
        if (ownNames.size && [...ownNames].every(name => localNames.has(name))) {
            visiting.delete(key);
            completed.add(key);
            return;
        }
        for (const name of references(unit)) {
            if (!ownNames.has(name)) await visitPackage(name);
        }
        visiting.delete(key);
        completed.add(key);
        result.files.push(file);
    };
    for (const file of explicitFiles) await visitFile(file);
    for (const name of requested) await visitPackage(name);
    return result;
}
