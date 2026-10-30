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
exports.getIncludeDirectories = getIncludeDirectories;
exports.collectIncludeDirectories = collectIncludeDirectories;
exports.buildXvlogArgs = buildXvlogArgs;
exports.validateWithVivado = validateWithVivado;
const fs_1 = require("fs");
const child_process_1 = require("child_process");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
/** 返回 xvlog 搜索 `include 文件时使用的目录，首项始终是源文件目录。 */
function getIncludeDirectories(sourcePath, includePaths = []) {
    const directories = [path.dirname(sourcePath), ...includePaths]
        .map(directory => directory.trim())
        .filter(Boolean)
        .map(directory => path.resolve(directory));
    return [...new Set(directories.map(directory => process.platform === 'win32' ? directory.toLowerCase() : directory))]
        .map(directory => process.platform === 'win32' ? directories.find(item => item.toLowerCase() === directory) : directory);
}
/** 提取常见的 `include "file.v" 指令；宏拼接形式仍由 xvlog 自行解析。 */
function getIncludeFiles(text) {
    return [...text.matchAll(/^\s*`include\s+"([^"]+)"/gm)].map(match => match[1]);
}
/** 递归查找 include 文件，并收集它们所在目录以支持相对路径和嵌套 include。 */
async function collectIncludeDirectories(sourcePath, candidateText, includePaths = []) {
    const directories = getIncludeDirectories(sourcePath, includePaths);
    const visitedFiles = new Set();
    const addDirectory = (directory) => {
        const resolved = path.resolve(directory);
        const exists = directories.some(item => item.toLowerCase() === resolved.toLowerCase());
        if (!exists)
            directories.push(resolved);
    };
    const findIncludeFile = async (fileName, parentDirectory) => {
        const searchDirectories = [parentDirectory, ...directories];
        for (const directory of searchDirectories) {
            const candidate = path.resolve(directory, fileName);
            try {
                if ((await fs_1.promises.stat(candidate)).isFile())
                    return candidate;
            }
            catch {
                // 保留给 xvlog 报告真正无法解析的 include 文件。
            }
        }
        return undefined;
    };
    const visit = async (text, parentDirectory) => {
        for (const fileName of getIncludeFiles(text)) {
            const includeFile = await findIncludeFile(fileName, parentDirectory);
            if (!includeFile)
                continue;
            addDirectory(path.dirname(includeFile));
            const key = process.platform === 'win32' ? includeFile.toLowerCase() : includeFile;
            if (visitedFiles.has(key))
                continue;
            visitedFiles.add(key);
            await visit(await fs_1.promises.readFile(includeFile, 'utf8'), path.dirname(includeFile));
        }
    };
    await visit(candidateText, path.dirname(sourcePath));
    return directories;
}
/** 构造 xvlog 参数，确保候选文件仍可引用源工程内的 include 文件。 */
function buildXvlogArgs(sourcePath, candidatePath, includePaths = []) {
    const languageArgs = path.extname(sourcePath).toLowerCase() === '.sv' ? ['--sv'] : [];
    const includeArgs = getIncludeDirectories(sourcePath, includePaths).flatMap(directory => ['-i', directory]);
    return [...languageArgs, ...includeArgs, candidatePath];
}
function findXvlog(vivadoPath) {
    const executable = process.platform === 'win32' ? 'xvlog.bat' : 'xvlog';
    const candidates = [vivadoPath, path.join(vivadoPath, 'bin', executable), path.join(vivadoPath, executable)];
    return candidates.find(candidate => {
        try {
            return (0, fs_1.statSync)(candidate).isFile();
        }
        catch {
            return false;
        }
    }) ?? null;
}
function runXvlog(command, args, cwd, timeoutMs) {
    return new Promise((resolve) => {
        let output = '';
        let timedOut = false;
        const isWindows = process.platform === 'win32';
        const child = isWindows
            ? (0, child_process_1.spawn)(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', command, ...args], { cwd, windowsHide: true })
            : (0, child_process_1.spawn)(command, args, { cwd, windowsHide: true });
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
async function validateWithVivado(sourcePath, candidateText, logDirectory, vivadoPath, timeoutMs, includePaths = []) {
    await fs_1.promises.mkdir(logDirectory, { recursive: true });
    const logPath = path.join(logDirectory, 'vivado-validation.log');
    const xvlog = findXvlog(vivadoPath.trim());
    let message = '';
    let toolOutput = '';
    let success = false;
    if (!vivadoPath.trim()) {
        message = '未配置 Vivado 安装目录。';
    }
    else if (!xvlog) {
        message = `未找到 xvlog：${vivadoPath}`;
    }
    else {
        const tempDirectory = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-'));
        try {
            const candidatePath = path.join(tempDirectory, path.basename(sourcePath));
            await fs_1.promises.writeFile(candidatePath, candidateText, 'utf8');
            const includeDirectories = await collectIncludeDirectories(sourcePath, candidateText, includePaths);
            const args = buildXvlogArgs(sourcePath, candidatePath, includeDirectories);
            const result = await runXvlog(xvlog, args, tempDirectory, timeoutMs);
            toolOutput = result.output;
            success = result.code === 0;
            message = success ? 'Vivado xvlog 校验通过。' : `Vivado xvlog 校验失败，退出码：${result.code}`;
        }
        finally {
            await fs_1.promises.rm(tempDirectory, { recursive: true, force: true });
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
    await fs_1.promises.writeFile(logPath, `${log}\n`, 'utf8');
    return { success, message, logPath };
}
