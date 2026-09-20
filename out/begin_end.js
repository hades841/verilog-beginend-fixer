"use strict";
/**
 * begin_end.ts - begin/end 检测与插入逻辑
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeBeginEnd = analyzeBeginEnd;
exports.calculateEndPositions = calculateEndPositions;
exports.applyEdits = applyEdits;
function lineEndsWithBegin(trimmed) {
    const noComment = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '');
    return /\bbegin\s*(?::\s*\w+)?\s*$/.test(noComment.trim());
}
function lineStartsWithBegin(trimmed) {
    return trimmed.startsWith('begin');
}
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
function shouldInsertBegin(lines, lineIndex, trimmedLine) {
    if (lineEndsWithBegin(trimmedLine))
        return false;
    const next = getNextEffectiveLine(lines, lineIndex);
    if (next && lineStartsWithBegin(next.trimmed))
        return false;
    return true;
}
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
// 修复：正确识别内联语句，排除 else begin / else if
function hasInlineStatement(line) {
    const noLineComment = line.replace(/\/\/.*$/, '');
    const noBlockComment = noLineComment.replace(/\/\*.*?\*\//, '').trim();
    if (noBlockComment === '')
        return false;
    if (/\bbegin\s*(?::\s*\w+)?\s*$/.test(noBlockComment))
        return false;
    if (/\)\s*$/.test(noBlockComment))
        return false;
    // else 同行语句检测
    const elseMatch = noBlockComment.match(/^else\s+(.*)/);
    if (elseMatch) {
        const afterElse = elseMatch[1].trim();
        // 排除 else if / else begin
        if (afterElse && !afterElse.startsWith('if') && !afterElse.startsWith('begin')) {
            return true;
        }
    }
    // if/for 同行语句检测
    if (/^if\s*\(/.test(noBlockComment) || /^for\s*\(/.test(noBlockComment)) {
        let depth = 0;
        for (let i = 0; i < noBlockComment.length; i++) {
            const char = noBlockComment[i];
            if (char === '(')
                depth++;
            else if (char === ')')
                depth--;
            else if (char === ';' && depth === 0)
                return true;
        }
    }
    return false;
}
function lineHasKeyword(line) {
    const trimmed = line.trim();
    return /^always\s*@\s*\(/.test(trimmed) ||
        /^initial\b/.test(trimmed) ||
        trimmed.startsWith('if') ||
        trimmed.startsWith('else') ||
        /^for\s*\(/.test(trimmed);
}
function analyzeBeginEnd(lines) {
    const insertBeginList = [];
    const totalLines = lines.length;
    let caseDepth = 0;
    for (let i = 0; i < totalLines; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (trimmed === "" || trimmed.startsWith("//"))
            continue;
        if (trimmed.match(/^case\s*\(/) || trimmed.match(/^case\s+/)) {
            caseDepth++;
        }
        if (trimmed === 'endcase' && caseDepth > 0) {
            caseDepth--;
        }
        if (caseDepth > 0)
            continue;
        // if/else 同行语句不报错，记录 inlineStmt
        if (lineHasKeyword(line) && hasInlineStatement(line)) {
            const keywordTrim = trimmed;
            if (keywordTrim.startsWith('else')) {
                // else stmt; → 提取语句
                const elseBody = keywordTrim.substring(4).trim();
                if (elseBody && !elseBody.startsWith('if') && !elseBody.startsWith('begin')) {
                    const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                    insertBeginList.push({ lineIndex: i, indent, type: 'else', inlineStmt: elseBody });
                }
            }
            else if (keywordTrim.startsWith('if') || keywordTrim.startsWith('for')) {
                // if (a) stmt; / for(...) stmt;
                const indent = (line.match(/^(\s*)/) || ['', ''])[1];
                insertBeginList.push({ lineIndex: i, indent, type: keywordTrim.startsWith('for') ? 'for' : 'if', inlineStmt: '__INLINE__' });
            }
            continue;
        }
        if (trimmed.match(/^always\s*@\s*\([^)]*\)/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'always' });
            }
            continue;
        }
        if (trimmed.match(/^initial\b/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'always' });
            }
            continue;
        }
        if (isIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'if' });
            }
            continue;
        }
        if (isElseIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'elseif' });
            }
            continue;
        }
        if (trimmed.match(/^else\b/)) {
            const next = getNextEffectiveLine(lines, i);
            if (next && (isIfLine(next.line) || isElseIfLine(next.line))) {
                continue;
            }
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'else' });
            }
            continue;
        }
        if (trimmed.match(/^for\s*\(/)) {
            if (shouldInsertBegin(lines, i, trimmed)) {
                insertBeginList.push({ lineIndex: i, indent: (line.match(/^(\s*)/) || ['', ''])[1], type: 'for' });
            }
            continue;
        }
    }
    return {
        success: true,
        message: `分析完成，需补 ${insertBeginList.length} 组 begin-end`,
        insertBeginList,
        totalLines
    };
}
function calculateEndPositions(lines, list) {
    const edits = [];
    const N = lines.length;
    const moduleKeywords = /^(module|endmodule|function|endfunction|task|endtask|always|initial|assign|wire|reg|input|output|inout|parameter)\b/;
    for (const point of list) {
        if (point.inlineStmt) {
            // 同行语句：替换原行 + 插入 begin/end
            if (point.type === 'else' && point.inlineStmt !== '__INLINE__') {
                // else yn_state_reg <= 4'd2; → else\nbegin\n    yn_state_reg <= 4'd2;\nend
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}begin\n${point.indent}    ${point.inlineStmt}\n${point.indent}end`
                });
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}else\n`,
                    replaceLine: point.lineIndex
                });
            }
            else {
                // if (a) stmt; / for(...) stmt; → 在行后插入 begin/end
                edits.push({ pos: point.lineIndex + 1, text: `${point.indent}begin` });
                edits.push({ pos: point.lineIndex + 2, text: `${point.indent}end` });
                edits.push({
                    pos: point.lineIndex + 1,
                    text: `${point.indent}`,
                    replaceLine: point.lineIndex
                });
            }
            continue;
        }
        // 正常插入 begin
        edits.push({ pos: point.lineIndex + 1, text: point.indent + 'begin' });
        let endPos = N;
        let depth = 0;
        let caseLevel = 0;
        for (let i = point.lineIndex + 1; i < N; i++) {
            const trimmed = lines[i].trim();
            if (trimmed === "" || trimmed.startsWith("//"))
                continue;
            if (trimmed.match(/^case\s*\(/) || trimmed.match(/^case\s+/))
                caseLevel++;
            if (trimmed === 'endcase')
                caseLevel--;
            if (caseLevel > 0)
                continue;
            if (lineStartsWithBegin(trimmed) || lineEndsWithBegin(trimmed))
                depth++;
            if (trimmed === 'end') {
                if (depth > 0)
                    depth--;
                else {
                    endPos = i;
                    break;
                }
            }
            if (depth === 0) {
                if (point.type === 'if' || point.type === 'elseif' || point.type === 'else') {
                    if (isIfLine(lines[i]) || isElseIfLine(lines[i]) || trimmed.match(/^else\b/)) {
                        endPos = i;
                        break;
                    }
                }
                else if (point.type === 'always') {
                    if (trimmed.match(/^always\s*@\s*\(/) || trimmed.match(/^initial\b/) || moduleKeywords.test(trimmed)) {
                        endPos = i;
                        break;
                    }
                }
            }
        }
        edits.push({ pos: endPos, text: point.indent + 'end' });
    }
    // 按 pos 倒序，replaceLine 优先
    edits.sort((a, b) => {
        if (a.replaceLine !== undefined && b.replaceLine === undefined)
            return -1;
        if (a.replaceLine === undefined && b.replaceLine !== undefined)
            return 1;
        return b.pos - a.pos;
    });
    return edits;
}
function applyEdits(lines, edits) {
    const result = [...lines];
    for (const edit of edits) {
        if (edit.replaceLine !== undefined) {
            result[edit.replaceLine] = edit.text.trimEnd();
        }
        else {
            result.splice(edit.pos, 0, edit.text);
        }
    }
    return result;
}
