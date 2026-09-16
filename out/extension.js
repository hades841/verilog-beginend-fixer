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
exports.fixVerilogBeginEnd = fixVerilogBeginEnd;
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
/**
 * 判断关键字行自身是否以 begin 结尾（同行写法）
 * 支持：always @(*) begin / if (s) begin / begin: label
 * 支持行尾注释：always @(*) begin
 */
function lineEndsWithBegin(trimmed) {
    const noComment = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '');
    return /\bbegin\s*(?::\s*\w+)?\s*$/.test(noComment.trim());
}
/**
 * 判断某一行是否以 begin 开头（独立 begin 行）
 */
function lineStartsWithBegin(trimmed) {
    return trimmed.startsWith('begin');
}
/**
 * 跳过空行和 // 注释行，找下一个有效行
 */
function getNextEffectiveLine(lines, fromIndex) {
    let i = fromIndex + 1;
    while (i < lines.length) {
        const trimmed = lines[i].trim();
        if (trimmed === "" || trimmed.startsWith("//")) {
            i++;
            continue;
        }
        return { line: lines[i], trimmed, index: i };
    }
    return null;
}
/**
 * 判断是否需要为关键字插入 begin：
 * 1. 关键字行自身以 begin 结尾 → 不插
 * 2. 下一有效行以 begin 开头（独立 begin 行）→ 不插
 * 其他情况 → 需要插
 */
function shouldInsertBegin(lines, lineIndex, trimmedLine) {
    if (lineEndsWithBegin(trimmedLine))
        return false;
    const next = getNextEffectiveLine(lines, lineIndex);
    if (next && lineStartsWithBegin(next.trimmed))
        return false;
    return true;
}
/**
 * 判断一行是否是 if 语句（支持嵌套括号）
 */
function isIfLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('if'))
        return false;
    const parenIdx = trimmed.indexOf('(');
    if (parenIdx === -1)
        return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(')
            depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0)
                return true;
        }
    }
    return false;
}
/**
 * 判断一行是否是 else if 语句（支持嵌套括号）
 */
function isElseIfLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('else'))
        return false;
    const ifIdx = trimmed.indexOf('if');
    if (ifIdx === -1)
        return false;
    const parenIdx = trimmed.indexOf('(', ifIdx);
    if (parenIdx === -1)
        return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(')
            depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0)
                return true;
        }
    }
    return false;
}
/**
 * 判断一行是否"关键字与代码写在同一行"
 * 去掉注释后，按结尾字符判断：
 * - 以 begin 结尾 → 合法
 * - 以 ) 结尾 → 合法（always @(...)、if(...)、else if(...)）
 * - 以 else 结尾 → 合法
 * - 以 initial 结尾 → 合法
 * - 以上都不满足 → 同行带语句，报错
 */
function hasInlineStatement(line) {
    const noLineComment = line.replace(/\/\/.*$/, '');
    const noBlockComment = noLineComment.replace(/\/\*.*?\*\//, '').trim();
    if (noBlockComment === '')
        return false;
    if (/\bbegin\s*(?::\s*\w+)?\s*$/.test(noBlockComment))
        return false;
    if (/\)\s*$/.test(noBlockComment))
        return false;
    if (/\belse\s*$/.test(noBlockComment))
        return false;
    if (/^initial\s*$/.test(noBlockComment))
        return false;
    return true;
}
/**
 * 判断一行是否包含 Verilog 关键字（用于同行检测的前置过滤）
 */
function lineHasKeyword(line) {
    const trimmed = line.trim();
    if (/^always\s*@\s*\(/.test(trimmed))
        return true;
    if (/^initial\b/.test(trimmed))
        return true;
    if (trimmed.startsWith('if'))
        return true;
    if (trimmed.startsWith('else'))
        return true;
    if (/^for\s*\(/.test(trimmed))
        return true;
    return false;
}
async function fixVerilogBeginEnd() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("没有打开的编辑器");
        return;
    }
    const doc = editor.document;
    const fileName = doc.fileName;
    if (!fileName.endsWith(".v") && !fileName.endsWith(".sv")) {
        vscode.window.showWarningMessage("当前不是 v/sv 文件");
        return;
    }
    // 空文件保护
    if (doc.lineCount === 0) {
        vscode.window.showInformationMessage("文件为空");
        return;
    }
    const text = doc.getText();
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    let hasInlineError = false;
    let errorLineNo = -1;
    const insertBeginList = [];
    let caseNest = 0;
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i];
        const trimLine = line.trim();
        if (trimLine === "" || trimLine.startsWith("//"))
            continue;
        // case 嵌套计数
        if (trimLine.match(/^case\s*\(/) || trimLine.match(/^case\s+/)) {
            caseNest++;
        }
        if (trimLine === 'endcase') {
            if (caseNest > 0)
                caseNest--;
        }
        if (caseNest > 0)
            continue;
        // 同行带语句报错（只检查包含关键字的行）
        if (lineHasKeyword(line)) {
            if (hasInlineStatement(line)) {
                hasInlineError = true;
                errorLineNo = i + 1;
                break;
            }
        }
        // always
        if (trimLine.match(/^always\s*@\s*\([^)]*\)/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "always" });
            }
            continue;
        }
        // initial
        if (trimLine.match(/^initial\b/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "always" });
            }
            continue;
        }
        // if
        if (isIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "if" });
            }
            continue;
        }
        // else if
        if (isElseIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "elseif" });
            }
            continue;
        }
        // else
        if (trimLine.match(/^else\b/)) {
            const next = getNextEffectiveLine(lines, i);
            if (next && isIfLine(next.line)) {
                continue;
            }
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "else" });
            }
            continue;
        }
        // for
        if (trimLine.match(/^for\s*\(/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "for" });
            }
            continue;
        }
    }
    if (hasInlineError) {
        vscode.window.showErrorMessage(`【终止处理】第${errorLineNo}行：关键字与代码语句写在同一行，请先修改代码！`);
        return;
    }
    const edits = [];
    const moduleLevelRe = /^(always|initial|module|endmodule|assign|reg|wire|input|output|inout|parameter|localparam|task|function)\b|^(?!(?:if|else|for|case|begin|end|endcase|endmodule|always|initial)\b)\w+\s*\(/;
    for (const pt of insertBeginList) {
        edits.push({ pos: pt.lineIndex + 1, text: `${pt.indent}begin` });
        let endInsertPos = totalLines;
        if (pt.type === 'if' || pt.type === 'elseif' || pt.type === 'else' || pt.type === 'for') {
            let scan = pt.lineIndex + 1;
            let nestLevel = 0;
            while (scan < totalLines) {
                const trim = lines[scan].trim();
                if (trim === "" || trim.startsWith("//")) {
                    scan++;
                    continue;
                }
                if (lineStartsWithBegin(trim) || lineEndsWithBegin(trim)) {
                    nestLevel++;
                    scan++;
                    continue;
                }
                if (trim === "end") {
                    if (nestLevel > 0) {
                        nestLevel--;
                        if (nestLevel === 0) {
                            let nextScan = scan + 1;
                            while (nextScan < totalLines) {
                                const nextTrim = lines[nextScan].trim();
                                if (nextTrim === "" || nextTrim.startsWith("//")) {
                                    nextScan++;
                                    continue;
                                }
                                const isIf = isIfLine(lines[nextScan]);
                                const isElseIf = isElseIfLine(lines[nextScan]);
                                const isElse = /^else\b/.test(nextTrim);
                                if (isIf || isElseIf || isElse) {
                                    scan = nextScan;
                                    break;
                                }
                                endInsertPos = scan + 1;
                                break;
                            }
                            if (endInsertPos !== totalLines)
                                break;
                        }
                    }
                    else {
                        endInsertPos = scan;
                        break;
                    }
                    scan++;
                    continue;
                }
                const isIf = isIfLine(lines[scan]);
                const isElseIf = isElseIfLine(lines[scan]);
                const isElse = /^else\b/.test(trim);
                if (isIf || isElseIf || isElse) {
                    scan++;
                    continue;
                }
                if (nestLevel === 0) {
                    endInsertPos = scan + 1;
                    break;
                }
                scan++;
            }
        }
        else {
            let scanIdx = pt.lineIndex + 1;
            let nestLevel = 0;
            while (scanIdx < totalLines) {
                const sTrim = lines[scanIdx].trim();
                if (sTrim === "" || sTrim.startsWith("//")) {
                    scanIdx++;
                    continue;
                }
                if (lineStartsWithBegin(sTrim) || lineEndsWithBegin(sTrim))
                    nestLevel++;
                if (sTrim === "end") {
                    if (nestLevel > 0) {
                        nestLevel--;
                    }
                    else {
                        endInsertPos = scanIdx;
                        break;
                    }
                }
                if (nestLevel === 0 && moduleLevelRe.test(sTrim)) {
                    endInsertPos = scanIdx;
                    break;
                }
                scanIdx++;
            }
        }
        edits.push({ pos: endInsertPos, text: `${pt.indent}end` });
    }
    edits.sort((a, b) => b.pos - a.pos);
    const output = [...lines];
    for (const op of edits) {
        output.splice(op.pos, 0, op.text);
    }
    const finalText = output.join("\n");
    const lastLine = doc.lineAt(doc.lineCount - 1);
    const fullRange = new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
    await editor.edit((editBuilder) => {
        editBuilder.replace(fullRange, finalText);
    });
    vscode.window.showInformationMessage(`处理完成，共补 ${insertBeginList.length} 组 begin-end，请务必核对代码！`);
}
function activate(context) {
    const disposable = vscode.commands.registerCommand("verilog-helper.fixBeginEnd", fixVerilogBeginEnd);
    context.subscriptions.push(disposable);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map