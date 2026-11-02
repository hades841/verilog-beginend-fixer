"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectPackageFiles = collectPackageFiles;
const fs_1 = require("fs");
const path = __importStar(require("path"));
// 保留字符串以读取 include 路径，屏蔽注释中的伪指令和包名称。
function withoutComments(text) {
    return text.replace(/"(?:\\.|[^"\\])*"|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, token => token.startsWith('"') ? token : token.replace(/[^\r\n]/g, ' '));
}
function packageNames(text) {
    return [...text.matchAll(/\bpackage\s+(?:(?:automatic|static)\s+)?([a-zA-Z_]\w*)\s*;/g)].map(match => match[1]);
}
function fileKey(file) {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
/** 只收集实际引用的包，按依赖顺序放在候选文件之前交给 xvlog。 */
async function collectPackageFiles(sourcePath, candidateText, includePaths, options = {}) {
    const includeDirectories = [...includePaths];
    const addDirectory = (directory) => {
        if (!includeDirectories.some(item => fileKey(item) === fileKey(directory))) {
            includeDirectories.push(path.resolve(directory));
        }
    };
    // 展开 include 仅用于发现包依赖；真正的预处理和语义检查仍由 xvlog 完成。
    const readUnit = async (file, text, stack = new Set()) => {
        const key = fileKey(file);
        if (stack.has(key))
            return '';
        const nextStack = new Set(stack).add(key);
        const clean = withoutComments(text);
        let expanded = '';
        let offset = 0;
        for (const match of clean.matchAll(/`include\s+"([^"]+)"/g)) {
            expanded += clean.slice(offset, match.index);
            offset = match.index + match[0].length;
            const fileName = match[1].replace(/[\\/]/g, path.sep);
            for (const directory of [path.dirname(file), ...includeDirectories]) {
                const includedPath = path.resolve(directory, fileName);
                let includedText;
                try {
                    includedText = await fs_1.promises.readFile(includedPath, 'utf8');
                }
                catch {
                    continue;
                } // 无法找到的 include 仍由 xvlog 报告。
                addDirectory(path.dirname(includedPath));
                expanded += await readUnit(includedPath, includedText, nextStack);
                break;
            }
        }
        return (expanded + clean.slice(offset)).replace(/"(?:\\.|[^"\\])*"/g, '');
    };
    const references = (text) => [...new Set([...text.matchAll(/\b([a-zA-Z_]\w*)\s*::/g)].map(match => match[1]))];
    const candidateUnit = await readUnit(sourcePath, candidateText);
    const localNames = new Set(packageNames(candidateUnit));
    const requested = references(candidateUnit).filter(name => !localNames.has(name));
    const explicitFiles = [...new Set((options.packageFiles ?? []).map(file => path.resolve(file)))];
    const result = { files: [], includeDirectories, unresolved: [] };
    if (!requested.length && !explicitFiles.length)
        return result;
    const providers = new Map();
    const texts = new Map();
    const addProvider = (name, file) => {
        const files = providers.get(name) ?? [];
        if (!files.some(item => fileKey(item) === fileKey(file)))
            files.push(file);
        providers.set(name, files);
    };
    const scanned = new Set();
    const ignored = new Set(['.git', 'node_modules', '.verilog-helper-logs', '.xil', 'xsim.dir']);
    const scan = async (directory) => {
        const key = fileKey(directory);
        if (scanned.has(key))
            return;
        scanned.add(key);
        let entries;
        try {
            entries = await fs_1.promises.readdir(directory, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const file = path.join(directory, entry.name);
            if (entry.isDirectory() && !ignored.has(entry.name.toLowerCase()))
                await scan(file);
            if (!entry.isFile() || !/\.(?:sv|v|svh|vh)$/i.test(entry.name) || fileKey(file) === fileKey(sourcePath))
                continue;
            const text = await fs_1.promises.readFile(file, 'utf8');
            const names = packageNames(withoutComments(text).replace(/"(?:\\.|[^"\\])*"/g, ''));
            if (!names.length)
                continue;
            texts.set(fileKey(file), text);
            for (const name of names)
                addProvider(name, file);
        }
    };
    for (const directory of [path.dirname(sourcePath), ...(options.searchRoots ?? []), ...includePaths, ...explicitFiles.map(file => path.dirname(file))])
        await scan(directory);
    // 显式配置优先，允许在多个工程副本包含同名包时指定正确文件。
    const explicitProviders = new Map();
    const units = new Map();
    const loadUnit = async (file) => {
        const key = fileKey(file);
        let unit = units.get(key);
        if (unit === undefined) {
            addDirectory(path.dirname(file));
            unit = await readUnit(file, texts.get(key) ?? await fs_1.promises.readFile(file, 'utf8'));
            units.set(key, unit);
        }
        return unit;
    };
    for (const file of explicitFiles) {
        if (fileKey(file) === fileKey(sourcePath))
            continue;
        for (const name of packageNames(await loadUnit(file))) {
            if (explicitProviders.has(name) && fileKey(explicitProviders.get(name)) !== fileKey(file)) {
                throw new Error(`包 ${name} 配置了多个定义文件，请检查 vivadoPackageFiles。`);
            }
            explicitProviders.set(name, file);
        }
    }
    const completed = new Set();
    const visiting = new Set();
    const visitPackage = async (name) => {
        if (localNames.has(name))
            return;
        const matches = providers.get(name) ?? [];
        const file = explicitProviders.get(name) ?? (matches.length === 1 ? matches[0] : undefined);
        if (!file) {
            if (matches.length > 1)
                throw new Error(`包 ${name} 存在多个定义：${matches.join('; ')}。请通过 vivadoPackageFiles 指定文件。`);
            if (!result.unresolved.includes(name))
                result.unresolved.push(name);
            return;
        }
        await visitFile(file);
    };
    const visitFile = async (file) => {
        const key = fileKey(file);
        if (key === fileKey(sourcePath) || completed.has(key))
            return;
        if (visiting.has(key))
            throw new Error(`包依赖存在循环：${file}`);
        visiting.add(key);
        const unit = await loadUnit(file);
        const ownNames = new Set(packageNames(unit));
        if (ownNames.size && [...ownNames].every(name => localNames.has(name))) {
            visiting.delete(key);
            completed.add(key);
            return;
        }
        for (const name of references(unit)) {
            if (!ownNames.has(name))
                await visitPackage(name);
        }
        visiting.delete(key);
        completed.add(key);
        result.files.push(file);
    };
    for (const file of explicitFiles)
        await visitFile(file);
    for (const name of requested)
        await visitPackage(name);
    return result;
}
