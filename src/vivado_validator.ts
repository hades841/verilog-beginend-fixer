import { promises as fs, statSync } from 'fs';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface VivadoValidationResult {
    success: boolean;
    message: string;
    logPath: string;
}

/** 返回 xvlog 搜索 `include 文件时使用的目录，首项始终是源文件目录。 */
export function getIncludeDirectories(sourcePath: string, includePaths: readonly string[] = []): string[] {
    const directories = [path.dirname(sourcePath), ...includePaths]
        .map(directory => directory.trim())
        .filter(Boolean)
        .map(directory => path.resolve(directory));
    return [...new Set(directories.map(directory => process.platform === 'win32' ? directory.toLowerCase() : directory))]
        .map(directory => process.platform === 'win32' ? directories.find(item => item.toLowerCase() === directory)! : directory);
}

/** 提取常见的 `include "file.v" 指令；宏拼接形式仍由 xvlog 自行解析。 */
function getIncludeFiles(text: string): string[] {
    return [...text.matchAll(/^\s*`include\s+"([^"]+)"/gm)].map(match => match[1]);
}

/** 递归查找 include 文件，并收集它们所在目录以支持相对路径和嵌套 include。 */
export async function collectIncludeDirectories(
    sourcePath: string,
    candidateText: string,
    includePaths: readonly string[] = []
): Promise<string[]> {
    const directories = getIncludeDirectories(sourcePath, includePaths);
    const visitedFiles = new Set<string>();
    const addDirectory = (directory: string) => {
        const resolved = path.resolve(directory);
        const exists = directories.some(item => item.toLowerCase() === resolved.toLowerCase());
        if (!exists) directories.push(resolved);
    };
    const findIncludeFile = async (fileName: string, parentDirectory: string): Promise<string | undefined> => {
        const searchDirectories = [parentDirectory, ...directories];
        for (const directory of searchDirectories) {
            const candidate = path.resolve(directory, fileName);
            try {
                if ((await fs.stat(candidate)).isFile()) return candidate;
            } catch {
                // 保留给 xvlog 报告真正无法解析的 include 文件。
            }
        }
        return undefined;
    };
    const visit = async (text: string, parentDirectory: string): Promise<void> => {
        for (const fileName of getIncludeFiles(text)) {
            const includeFile = await findIncludeFile(fileName, parentDirectory);
            if (!includeFile) continue;
            addDirectory(path.dirname(includeFile));
            const key = process.platform === 'win32' ? includeFile.toLowerCase() : includeFile;
            if (visitedFiles.has(key)) continue;
            visitedFiles.add(key);
            await visit(await fs.readFile(includeFile, 'utf8'), path.dirname(includeFile));
        }
    };
    await visit(candidateText, path.dirname(sourcePath));
    return directories;
}

/** 构造 xvlog 参数，确保候选文件仍可引用源工程内的 include 文件。 */
export function buildXvlogArgs(sourcePath: string, candidatePath: string, includePaths: readonly string[] = []): string[] {
    const languageArgs = path.extname(sourcePath).toLowerCase() === '.sv' ? ['--sv'] : [];
    const includeArgs = getIncludeDirectories(sourcePath, includePaths).flatMap(directory => ['-i', directory]);
    return [...languageArgs, ...includeArgs, candidatePath];
}

function findXvlog(vivadoPath: string): string | null {
    const executable = process.platform === 'win32' ? 'xvlog.bat' : 'xvlog';
    const candidates = [vivadoPath, path.join(vivadoPath, 'bin', executable), path.join(vivadoPath, executable)];
    return candidates.find(candidate => {
        try { return statSync(candidate).isFile(); }
        catch { return false; }
    }) ?? null;
}

function runXvlog(command: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number; output: string }> {
    return new Promise((resolve) => {
        let output = '';
        let timedOut = false;
        const isWindows = process.platform === 'win32';
        const child = isWindows
            ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', command, ...args], { cwd, windowsHide: true })
            : spawn(command, args, { cwd, windowsHide: true });
        const timer = setTimeout(() => {
            timedOut = true;
            child.kill();
        }, timeoutMs);

        child.stdout.on('data', data => { output += data.toString(); });
        child.stderr.on('data', data => { output += data.toString(); });
        child.on('error', error => { output += `启动失败：${error.message}\n`; });
        child.on('close', code => {
            clearTimeout(timer);
            resolve({ code: timedOut ? -1 : code ?? -1, output: timedOut ? `${output}\n校验超时。\n` : output });
        });
    });
}

/** 使用 Vivado xvlog 校验候选代码，并始终写出包含完整候选文件的日志。 */
export async function validateWithVivado(
    sourcePath: string,
    candidateText: string,
    logDirectory: string,
    vivadoPath: string,
    timeoutMs: number,
    includePaths: readonly string[] = []
): Promise<VivadoValidationResult> {
    await fs.mkdir(logDirectory, { recursive: true });
    const logPath = path.join(logDirectory, 'vivado-validation.log');
    const xvlog = findXvlog(vivadoPath.trim());
    let message = '';
    let toolOutput = '';
    let success = false;

    if (!vivadoPath.trim()) {
        message = '未配置 Vivado 安装目录。';
    } else if (!xvlog) {
        message = `未找到 xvlog：${vivadoPath}`;
    } else {
        const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-'));
        try {
            const candidatePath = path.join(tempDirectory, path.basename(sourcePath));
            await fs.writeFile(candidatePath, candidateText, 'utf8');
            const includeDirectories = await collectIncludeDirectories(sourcePath, candidateText, includePaths);
            const args = buildXvlogArgs(sourcePath, candidatePath, includeDirectories);
            const result = await runXvlog(xvlog, args, tempDirectory, timeoutMs);
            toolOutput = result.output;
            success = result.code === 0;
            message = success ? 'Vivado xvlog 校验通过。' : `Vivado xvlog 校验失败，退出码：${result.code}`;
        } finally {
            await fs.rm(tempDirectory, { recursive: true, force: true });
        }
    }

    const log = [
        '================================================================================',
        `时间：${new Date().toLocaleString('zh-CN')}`,
        `源文件：${sourcePath}`,
        `Vivado 配置：${vivadoPath || '未配置'}`,
        `Include 搜索目录：${await collectIncludeDirectories(sourcePath, candidateText, includePaths).then(directories => directories.join('; '))}`,
        `结果：${message}`,
        '',
        '===== Vivado xvlog 输出 =====',
        toolOutput || '无输出',
        '',
        '===== 转换后的完整文件 =====',
        candidateText
    ].join('\n');
    await fs.writeFile(logPath, `${log}\n`, 'utf8');
    return { success, message, logPath };
}
