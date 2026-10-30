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
const fs_1 = require("fs");
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const vivado_validator_1 = require("./vivado_validator");
async function run() {
    const logDirectory = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-test-'));
    const firstCandidate = 'module first_check; endmodule\n';
    const secondCandidate = 'module second_check; endmodule\n';
    try {
        const sourcePath = path.join('project', 'rtl', 'top.v');
        const includeDirectories = (0, vivado_validator_1.getIncludeDirectories)(sourcePath, [path.join('project', 'include'), path.join('project', 'rtl')]);
        assert.deepStrictEqual(includeDirectories, [
            path.resolve('project', 'rtl'),
            path.resolve('project', 'include')
        ]);
        assert.deepStrictEqual((0, vivado_validator_1.buildXvlogArgs)(sourcePath, path.join('temporary', 'top.v'), [path.join('project', 'include')]), ['-i', path.resolve('project', 'rtl'), '-i', path.resolve('project', 'include'), path.join('temporary', 'top.v')]);
        const includeProject = await fs_1.promises.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-include-project-'));
        try {
            const sourcePath = path.join(includeProject, 'rtl', 'top.v');
            const registerFile = path.join(includeProject, 'qwe', 'reg_define.v');
            const nestedFile = path.join(includeProject, 'qwe', 'nested', 'common.v');
            await fs_1.promises.mkdir(path.dirname(nestedFile), { recursive: true });
            await fs_1.promises.writeFile(registerFile, '`include "nested/common.v"\n', 'utf8');
            await fs_1.promises.writeFile(nestedFile, '`define TEST_VALUE 1\n', 'utf8');
            assert.deepStrictEqual(await (0, vivado_validator_1.collectIncludeDirectories)(sourcePath, '`include "../qwe/reg_define.v"\n'), [path.resolve(includeProject, 'rtl'), path.resolve(includeProject, 'qwe'), path.resolve(includeProject, 'qwe', 'nested')]);
        }
        finally {
            await fs_1.promises.rm(includeProject, { recursive: true, force: true });
        }
        const missing = await (0, vivado_validator_1.validateWithVivado)('syntax_check.v', firstCandidate, logDirectory, '', 1000);
        assert.strictEqual(missing.success, false);
        assert.ok((await fs_1.promises.readFile(missing.logPath, 'utf8')).includes(firstCandidate));
        const invoked = await (0, vivado_validator_1.validateWithVivado)('syntax_check.v', secondCandidate, logDirectory, process.execPath, 10000);
        assert.strictEqual(invoked.success, false);
        assert.strictEqual(invoked.logPath, missing.logPath);
        const log = await fs_1.promises.readFile(invoked.logPath, 'utf8');
        assert.ok(log.includes('===== Vivado xvlog 输出 ====='));
        assert.ok(log.includes('===== 转换后的完整文件 ====='));
        assert.ok(log.includes(secondCandidate));
        assert.ok(!log.includes(firstCandidate));
    }
    finally {
        await fs_1.promises.rm(logDirectory, { recursive: true, force: true });
    }
}
run().then(() => console.log('Vivado 校验日志用例通过'));
