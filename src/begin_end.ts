/**
 * begin_end.ts - begin/end 检测与插入逻辑
 */

function lineEndsWithBegin(trimmed: string): boolean {
    const noComment = trimmed.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//, '');
    return /\bbegin\s*(?::\s*\w+)?\s*$/.test(noComment.trim());
}

function lineStartsWithBegin(trimmed: string): boolean {
    return trimmed.startsWith('begin');
}

function getNextEffectiveLine(lines: string[], fromIndex: number): { line: string; trimmed: string; index: number } | null {
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

function shouldInsertBegin(lines: string[], lineIndex: number, trimmedLine: string): boolean {
    if (lineEndsWithBegin(trimmedLine)) return false;
    const next = getNextEffectiveLine(lines, lineIndex);
    if (next && lineStartsWithBegin(next.trimmed)) return false;
    return true;
}

function isIfLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('if')) return false;
    const parenIdx = trimmed.indexOf('(');
    if (parenIdx === -1) return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0) return true;
        }
    }
    return false;
}

function isElseIfLine(line: string): boolean {
    const trimmed = line.trim();
    if (!trimmed.startsWith('else')) return false;
    const ifIdx = trimmed.indexOf('if');
    if (ifIdx === -1) return false;
    const parenIdx = trimmed.indexOf('(', ifIdx);
    if (parenIdx === -1) return false;
    let depth = 0;
    for (let i = parenIdx; i < trimmed.length; i++) {
        if (trimmed[i] === '(') depth++;
        else if (trimmed[i] === ')') {
            depth--;
            if (depth === 0) return true;
        }
    }
    return false;
}

function hasInlineStatement(line: string): boolean {
    const noLineComment = line.replace(/\/\/.*$/, '');
    const noBlockComment = noLineComment.replace(/\/\*.*?\*\//, '').trim();
    if (noBlockComment === '') return false;
    if (/\bbegin\s*(?::\s*\w+)?\s*$/.test(noBlockComment)) return false;
    if (/\)\s*$/.test(noBlockComment)) return false;
    if (/\belse\s*$/.test(noBlockComment)) return false;
    if (/^initial\s*$/.test(noBlockComment)) return false;
    return true;
}

function lineHasKeyword(line: string): boolean {
    const trimmed = line.trim();
    if (/^always\s*@\s*\(/.test(trimmed)) return true;
    if (/^initial\b/.test(trimmed)) return true;
    if (trimmed.startsWith('if')) return true;
    if (trimmed.startsWith('else')) return true;
    if (/^for\s*\(/.test(trimmed)) return true;
    return false;
}

export interface InsertPoint {
    lineIndex: number;
    indent: string;
    type: 'always' | 'if' | 'elseif' | 'else' | 'for';
}

export function analyzeBeginEnd(lines: string[]): { success: boolean; message: string; insertBeginList: InsertPoint[]; totalLines: number } {
    const totalLines = lines.length;

    let hasInlineError = false;
    let errorLineNo = -1;
    const insertBeginList: InsertPoint[] = [];

    let caseNest = 0;

    for (let i = 0; i < totalLines; i++) {
        const line = lines[i];
        const trimLine = line.trim();

        if (trimLine === "" || trimLine.startsWith("//")) continue;

        if (trimLine.match(/^case\s*\(/) || trimLine.match(/^case\s+/)) {
            caseNest++;
        }
        if (trimLine === 'endcase') {
            if (caseNest > 0) caseNest--;
        }
        if (caseNest > 0) continue;

        if (lineHasKeyword(line)) {
            if (hasInlineStatement(line)) {
                hasInlineError = true;
                errorLineNo = i + 1;
                break;
            }
        }

        if (trimLine.match(/^always\s*@\s*\([^)]*\)/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "always" });
            }
            continue;
        }

        if (trimLine.match(/^initial\b/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "always" });
            }
            continue;
        }

        if (isIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "if" });
            }
            continue;
        }

        if (isElseIfLine(line)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "elseif" });
            }
            continue;
        }

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

        if (trimLine.match(/^for\s*\(/)) {
            if (shouldInsertBegin(lines, i, trimLine)) {
                const indent = (line.match(/^(\s*)/) ?? ["", ""])[1];
                insertBeginList.push({ lineIndex: i, indent, type: "for" });
            }
            continue;
        }
    }

    if (hasInlineError) {
        return {
            success: false,
            message: `【终止处理】第${errorLineNo}行：关键字与代码语句写在同一行，请先修改代码！`,
            insertBeginList: [],
            totalLines
        };
    }

    return {
        success: true,
        message: `分析完成，需补 ${insertBeginList.length} 组 begin-end`,
        insertBeginList,
        totalLines
    };
}

export function calculateEndPositions(lines: string[], insertBeginList: InsertPoint[]): { pos: number; text: string }[] {
    const totalLines = lines.length;
    const edits: { pos: number; text: string }[] = [];

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
                            if (endInsertPos !== totalLines) break;
                        }
                    } else {
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

        } else {
            let scanIdx = pt.lineIndex + 1;
            let nestLevel = 0;
            while (scanIdx < totalLines) {
                const sTrim = lines[scanIdx].trim();
                if (sTrim === "" || sTrim.startsWith("//")) {
                    scanIdx++;
                    continue;
                }

                if (lineStartsWithBegin(sTrim) || lineEndsWithBegin(sTrim)) nestLevel++;
                if (sTrim === "end") {
                    if (nestLevel > 0) {
                        nestLevel--;
                    } else {
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

    return edits;
}