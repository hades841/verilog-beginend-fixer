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
const assert = __importStar(require("assert"));
const begin_end_1 = require("./begin_end");
function transform(source) {
    const lines = source.trim().split('\n');
    const result = (0, begin_end_1.analyzeBeginEnd)(lines);
    assert.ok(result.success, result.message);
    return {
        output: (0, begin_end_1.applyEdits)(lines, (0, begin_end_1.calculateEndPositions)(lines, result.insertBeginList)).join('\n'),
        insertions: result.insertBeginList.length
    };
}
const cases = [
    { name: 'reported nested else-if', expectedInsertions: 5, source: `always @(posedge clk) begin
    if (!rst_n)
        a <= 0;
    else if (lock)
        if (enable)
            a <= a + 1;
        else
            a <= a;
    else
        a <= 0;
end`, checks: o => assert.ok(o.includes('else if (lock) begin\n        if (enable)') && o.includes('    end\n    else begin\n        a <= 0;')) },
    { name: 'reported source with comments and literals', expectedInsertions: 5, source: `always @(posedge outclk or negedge rst_n) begin
    if(!rst_n)
        pdo1_bram_raddr <= 10'h3ff; // invalid address
    else if(receive_lock)
        if(rx_waite_bram_rd_en && read_type[1]) // enabled
            pdo1_bram_raddr <= pdo1_bram_raddr + 1'd1;
        else
            pdo1_bram_raddr <= pdo1_bram_raddr;
    else
        pdo1_bram_raddr <= 10'h3ff;
end`, checks: o => assert.ok(o.includes('else if(receive_lock) begin') && o.includes("pdo1_bram_raddr <= 10'h3ff;\n    end\nend")) },
    { name: 'end 与 else if 同行', expectedInsertions: 2, source: `always @(posedge clk or negedge rst_n) begin
    if (!rst_n) begin
        rx_busy <= 8'h0;
    end else if (state != IDLE)
        rx_busy <= 1'b1;
    else
        rx_busy <= 1'b0;
end`, checks: o => assert.ok(o.includes("end else if (state != IDLE) begin\n        rx_busy <= 1'b1;\n    end\n    else begin")) },
    { name: 'single if', expectedInsertions: 1, source: `if (a)
    x = 1;`, checks: o => assert.ok(o.includes('if (a) begin\n    x = 1;\nend')) },
    { name: 'if else', expectedInsertions: 2, source: `if (a)
    x = 1;
else
    x = 0;`, checks: o => assert.strictEqual((o.match(/\bbegin\b/g) || []).length, 2) },
    { name: 'else-if chain', expectedInsertions: 3, source: `if (a)
    x = 1;
else if (b)
    x = 2;
else
    x = 3;`, checks: o => assert.strictEqual((o.match(/\bbegin\b/g) || []).length, 3) },
    { name: 'multiline condition', expectedInsertions: 1, source: `if (a &&
    b)
    x = 1;`, checks: o => assert.ok(o.includes('    b) begin')) },
    { name: 'inline if', expectedInsertions: 1, source: `if (a) x = 1;`, checks: o => assert.ok(o.includes('if (a)\nbegin\n    x = 1;\nend')) },
    { name: 'existing begin is unchanged', expectedInsertions: 0, source: `if (a) begin
    x = 1;
end`, checks: o => assert.strictEqual(o, `if (a) begin
    x = 1;
end`) },
    { name: 'for loop', expectedInsertions: 1, source: `for (i = 0; i < 2; i = i + 1)
    x[i] = i;`, checks: o => assert.ok(o.includes('for (i = 0; i < 2; i = i + 1) begin')) },
    { name: 'always single statement', expectedInsertions: 1, source: `always @(posedge clk)
    q <= d;`, checks: o => assert.ok(o.includes('always @(posedge clk) begin')) },
    { name: 'initial single statement', expectedInsertions: 1, source: `initial
    q = 0;`, checks: o => assert.ok(o.includes('initial begin')) },
    { name: 'nested if', expectedInsertions: 2, source: `if (a)
    if (b)
        x = 1;`, checks: o => assert.ok(o.includes('if (a) begin\n    if (b) begin')) },
    { name: 'blank line in body', expectedInsertions: 1, source: `if (a)

    x = 1;`, checks: o => assert.ok(o.includes('if (a) begin\n\n    x')) },
    { name: 'line comment', expectedInsertions: 1, source: `if (a) // condition
    x = 1; // assignment`, checks: o => assert.ok(o.includes('if (a) begin // condition')) },
    { name: '行尾块注释', expectedInsertions: 1, source: `if (a) /* condition */
    x = 1;`, checks: o => assert.ok(o.includes('if (a) begin /* condition */')) },
    { name: 'else inline statement', expectedInsertions: 1, source: `else x = 0;`, checks: o => assert.ok(o.includes('else\nbegin\n    x = 0;\nend')) },
    { name: 'if with block body', expectedInsertions: 0, source: `if (a)
begin
    x = 1;
end`, checks: o => assert.strictEqual((o.match(/\bbegin\b/g) || []).length, 1) },
    { name: 'for with nested if', expectedInsertions: 2, source: `for (i = 0; i < 2; i = i + 1)
    if (a[i])
        x[i] = 1;`, checks: o => assert.ok(o.includes('for (i = 0; i < 2; i = i + 1) begin\n    if')) },
    { name: 'always with if else', expectedInsertions: 3, source: `always @(posedge clk)
    if (a)
        q <= 1;
    else
        q <= 0;`, checks: o => assert.ok(o.endsWith('end')) },
    { name: 'case statement body', expectedInsertions: 1, source: `if (a)
    case (sel)
        1'b0: x = 0;
        default: x = 1;
    endcase`, checks: o => assert.ok(o.includes('endcase\nend')) },
    { name: 'named begin block', expectedInsertions: 0, source: `if (a) begin : named
    x = 1;
end`, checks: o => assert.strictEqual((o.match(/\bbegin\b/g) || []).length, 1) },
    { name: 'three-level nested if', expectedInsertions: 3, source: `if (a)
    if (b)
        if (c)
            x = 1;`, checks: o => assert.strictEqual((o.match(/\bbegin\b/g) || []).length, 3) },
    { name: 'else followed by if on next line', expectedInsertions: 4, source: `if (a)
    x = 1;
else
    if (b)
        x = 2;
    else
        x = 3;`, checks: o => assert.ok(o.includes('else begin\n    if (b)')) },
];
for (const test of cases) {
    const { output, insertions } = transform(test.source);
    assert.strictEqual(insertions, test.expectedInsertions, test.name);
    test.checks(output);
}
console.log(`${cases.length} begin/end transformation cases passed`);
