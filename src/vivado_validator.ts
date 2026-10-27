import { promises as fs, statSync } from 'fs';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';

export interface VivadoValidationResult {
    success: boolean;
    message: string;
    logPath: string;
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
    timeoutMs: number
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
            const args = path.extname(sourcePath).toLowerCase() === '.sv' ? ['--sv', candidatePath] : [candidatePath];
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
