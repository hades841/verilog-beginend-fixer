import * as assert from 'assert';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { collectPackageFiles, PackageOptions } from './sv_packages';
import { buildXvlogArgs, validateWithVivado } from './vivado_validator';
import { analyzeBeginEnd, applyEdits, calculateEndPositions } from './begin_end';

interface TestCase {
    name: string;
    source: string;
    files: Record<string, string>;
    expected?: string[];
    unresolved?: string[];
    explicit?: string[];
    error?: RegExp;
}

const cases: TestCase[] = [
    { name: '按包声明查找，不依赖文件名', source: 'import configPackage::*;', files: {
        'common/settings.sv': 'package configPackage; parameter WIDTH = 8; endpackage'
    }, expected: ['common/settings.sv'] },
    { name: '递归排列依赖', source: 'import configPackage::*;', files: {
        'a.sv': 'package configPackage; import types::*; endpackage',
        'b.sv': 'package types; import constants::*; endpackage',
        'c.sv': 'package constants; endpackage'
    }, expected: ['c.sv', 'b.sv', 'a.sv'] },
    { name: '不带 import 的限定名', source: 'module top; configPackage::word_t value; endmodule', files: {
        'pkg.sv': 'package configPackage; typedef logic [7:0] word_t; endpackage'
    }, expected: ['pkg.sv'] },
    { name: '重复引用只编译一次', source: 'import configPackage::*; import configPackage::W; configPackage::t x;', files: {
        'pkg.sv': 'package configPackage; endpackage'
    }, expected: ['pkg.sv'] },
    { name: '不编译无关模块和包', source: 'import good::*;', files: {
        'good.sv': 'package good; endpackage', 'bad.sv': 'package bad; 这不是合法代码', 'other.sv': 'module broken'
    }, expected: ['good.sv'] },
    { name: '包依赖循环可诊断', source: 'import a::*;', files: {
        'a.sv': 'package a; import b::*; endpackage', 'b.sv': 'package b; import a::*; endpackage'
    }, error: /包依赖存在循环/ },
    { name: '同名包可诊断', source: 'import a::*;', files: {
        'one.sv': 'package a; endpackage', 'two.sv': 'package a; endpackage'
    }, error: /包 a 存在多个定义/ },
    { name: '显式文件消除同名歧义', source: 'import a::*;', files: {
        'one.sv': 'package a; endpackage', 'two.sv': 'package a; endpackage'
    }, explicit: ['two.sv'], expected: ['two.sv'] },
    { name: '显式配置冲突可诊断', source: 'import a::*;', files: {
        'one.sv': 'package a; endpackage', 'two.sv': 'package a; endpackage'
    }, explicit: ['one.sv', 'two.sv'], error: /配置了多个定义文件/ },
    { name: '候选文件内定义的包不重复编译', source: 'package localPkg; endpackage import localPkg::*;', files: {
        'rtl/top.sv': 'package localPkg; endpackage'
    }, expected: [] },
    { name: 'include 内的包不重复编译', source: '`include "local.svh"\nimport localPkg::*;', files: {
        'rtl/local.svh': 'package localPkg; endpackage'
    }, expected: [] },
    { name: '已 include 的显式包不重复编译', source: '`include "local.svh"\nimport localPkg::*;', files: {
        'rtl/local.svh': 'package localPkg; endpackage'
    }, explicit: ['rtl/local.svh'], expected: [] },
    { name: 'include 内的 import 参与依赖解析', source: '`include "imports.svh"', files: {
        'rtl/imports.svh': 'import configPackage::*;', 'pkg.sv': 'package configPackage; endpackage'
    }, expected: ['pkg.sv'] },
    { name: '包内嵌套 include 参与依赖解析', source: 'import a::*;', files: {
        'pkg/a.sv': 'package a;\n`include "nested/imports.svh"\nendpackage',
        'pkg/nested/imports.svh': 'import b::*;', 'pkg/b.sv': 'package b; endpackage'
    }, expected: ['pkg/b.sv', 'pkg/a.sv'] },
    { name: '注释和字符串不产生依赖', source: '// import fake::*;\n/* import other::*; */\nmodule top; string s="missing::x"; endmodule', files: {}, expected: [] },
    { name: '注释里的伪包定义被忽略', source: 'import a::*;', files: {
        'fake.sv': '// package a;\n/* package a; */', 'real.sv': 'package a; endpackage'
    }, expected: ['real.sv'] },
    { name: '缺失包保留给 xvlog 报错', source: 'import missing::*;', files: {}, expected: [], unresolved: ['missing'] },
    { name: '同文件多个包只编译一次', source: 'import a::*; import b::*;', files: {
        'both.sv': 'package a; endpackage package b; import a::*; endpackage'
    }, expected: ['both.sv'] },
    { name: '支持 automatic 和 static 包声明', source: 'import a::*; import b::*;', files: {
        'a.sv': 'package automatic a; endpackage', 'b.sv': 'package static b; endpackage'
    }, expected: ['a.sv', 'b.sv'] },
    { name: '支持 Verilog 扩展名内的包', source: 'import a::*;', files: {
        'pkg.v': 'package a; endpackage'
    }, expected: ['pkg.v'] },
    { name: '显式配置包含包定义的包装文件', source: 'import a::*;', files: {
        'wrapper.sv': '`include "definitions.svh"', 'definitions.svh': 'package a; endpackage'
    }, explicit: ['wrapper.sv'], expected: ['wrapper.sv'] },
    { name: 'include 循环不会无限递归', source: '`include "one.svh"\nimport a::*;', files: {
        'rtl/one.svh': '`include "two.svh"', 'rtl/two.svh': '`include "one.svh"',
        'pkg.sv': 'package a; endpackage'
    }, expected: ['pkg.sv'] },
    { name: '忽略依赖目录中的无关同名包', source: 'import a::*;', files: {
        'pkg.sv': 'package a; endpackage', 'node_modules/fake.sv': 'package a; endpackage'
    }, expected: ['pkg.sv'] }
];

async function run(): Promise<void> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'verilog-helper-package-tests-'));
    try {
        for (const [index, test] of cases.entries()) {
            const directory = path.join(root, String(index));
            const sourcePath = path.join(directory, 'rtl', 'top.sv');
            await fs.mkdir(path.dirname(sourcePath), { recursive: true });
            for (const [file, text] of Object.entries(test.files)) {
                const target = path.join(directory, file);
                await fs.mkdir(path.dirname(target), { recursive: true });
                await fs.writeFile(target, text);
            }
            const options: PackageOptions = {
                searchRoots: [directory], packageFiles: test.explicit?.map(file => path.join(directory, file))
            };
            const resolve = () => collectPackageFiles(sourcePath, test.source, [path.dirname(sourcePath)], options);
            if (test.error) {
                await assert.rejects(resolve, test.error, test.name);
            } else {
                const result = await resolve();
                assert.deepStrictEqual(result.files, test.expected?.map(file => path.join(directory, file)), test.name);
                assert.deepStrictEqual(result.unresolved, test.unresolved ?? [], test.name);
            }
        }
        // 工作区外的显式包，以及只在 include 搜索目录中的包。
        const external = path.join(root, 'external', 'config.sv');
        await fs.mkdir(path.dirname(external));
        await fs.writeFile(external, 'package configPackage; endpackage');
        const sourcePath = path.join(root, 'standalone', 'top.sv');
        for (const options of [{ packageFiles: [external] }, {}]) {
            const dirs = options.packageFiles ? [] : [path.dirname(external)];
            assert.deepStrictEqual((await collectPackageFiles(sourcePath, 'import configPackage::*;', dirs, options)).files, [external]);
        }
        const externalDependency = path.join(path.dirname(external), 'base.sv');
        await fs.writeFile(externalDependency, 'package base; endpackage');
        await fs.writeFile(external, 'package configPackage; import base::*; endpackage');
        assert.deepStrictEqual((await collectPackageFiles(sourcePath, 'import configPackage::*;', [], {
            packageFiles: [external]
        })).files, [externalDependency, external]);
        const args = buildXvlogArgs('top.v', 'candidate.v', [], [external]);
        assert.strictEqual(args[0], '--sv');
        assert.deepStrictEqual(args.slice(-2), [external, 'candidate.v']);
        console.log(`${cases.length + 4} 个 SystemVerilog 包依赖用例通过`);

        const vivadoPath = process.env.VERILOG_HELPER_TEST_VIVADO;
        if (vivadoPath) await runVivado(root, vivadoPath);
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}

async function runVivado(root: string, vivadoPath: string): Promise<void> {
    const directory = path.join(root, '实际工程 含空格');
    const sourcePath = path.join(directory, 'rtl', 'top.sv');
    const packagePath = path.join(directory, 'packages', 'arbitrary-name.sv');
    const constantPath = path.join(directory, 'packages', 'constants.sv');
    await fs.mkdir(path.dirname(sourcePath), { recursive: true });
    await fs.mkdir(path.dirname(packagePath), { recursive: true });
    await fs.writeFile(constantPath, 'package constants; parameter WIDTH = 8; endpackage');
    await fs.writeFile(packagePath, 'package configPackage; import constants::*; typedef logic [WIDTH-1:0] word_t; endpackage');
    const original = 'import configPackage::*;\nmodule top(input clk, output word_t q); always @(posedge clk) if (clk) q <= 1; endmodule';
    await fs.writeFile(sourcePath, original);
    const check = async (name: string, text: string, expected: boolean, options: PackageOptions = { searchRoots: [directory] }) => {
        const result = await validateWithVivado(sourcePath, text, path.join(root, 'logs'), vivadoPath, 30000, [], options);
        const log = await fs.readFile(result.logPath, 'utf8');
        assert.strictEqual(result.success, expected, `${name}\n${log}`);
        assert.ok(log.includes(text));
        assert.strictEqual(await fs.readFile(sourcePath, 'utf8'), original);
        console.log(`真实 xvlog：${name} 通过`);
        return log;
    };
    const log = await check('自动发现并先编译两级包依赖', original, true);
    assert.ok(log.indexOf(constantPath) < log.indexOf(packagePath));
    await check('直接使用包限定名', 'module top; configPackage::word_t value; endmodule', true);
    await check('包确实缺失时拒绝候选文件', 'import missingPackage::*; module top; endmodule', false);
    await check('候选文件语法错误仍被拒绝', 'import configPackage::*; module top; always begin if ( ) ; end endmodule', false);
    const brokenPackage = path.join(root, 'broken-package.sv');
    await fs.writeFile(brokenPackage, 'package configPackage; typedef logic [; endpackage');
    const brokenLog = await check('包文件语法错误仍被拒绝', 'import configPackage::*; module top; endmodule', false, { packageFiles: [brokenPackage] });
    assert.ok(brokenLog.includes('ERROR:'));
    assert.ok(!brokenLog.includes('未找到定义的作用域引用：configPackage'));
    await check('显式配置工作区外包文件', original, true, { packageFiles: [constantPath, packagePath] });
    const prepLog = await check('配置文件缺失时仍输出完整失败日志', original, false, { packageFiles: [path.join(root, 'not-found.sv')] });
    assert.ok(prepLog.includes('Vivado 校验准备失败'));

    const attachment = process.env.VERILOG_HELPER_TEST_SOURCE;
    if (attachment) {
        const text = await fs.readFile(attachment, 'utf8');
        const lines = text.split(/\r?\n/);
        const analysis = analyzeBeginEnd(lines);
        const candidate = applyEdits(lines, calculateEndPositions(lines, analysis.insertBeginList)).join('\n');
        await check('用户粘贴代码及测试包定义', candidate, true);
    }
}

run().catch(error => { console.error(error); process.exitCode = 1; });
