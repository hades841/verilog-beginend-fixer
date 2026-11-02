# 更新日志

## 1.3.5

- 修复单独校验 SystemVerilog 文件时，因未编译 `import configPackage::*;` 等包依赖而误报未声明的问题。
- 自动在当前工作区、源文件目录和 include 搜索目录中按包声明查找定义文件，并递归按依赖顺序先编译所需包文件。
- 支持 `包名::成员`、嵌套 include 中的包引用，以及已 include 的包文件去重；不编译无关模块或包。
- 新增 `verilog-helper.vivadoPackageFiles`，可指定工作区外包文件或解决同名包歧义；相对路径以当前工作区为基准。
- 日志新增包文件编译顺序、未找到的作用域引用和实际 xvlog 命令；依赖准备失败时也保留完整候选文件。校验仍以真实 xvlog 结果为准。

## 1.3.4

- 修复 `end else <单行语句>;` 的转换：现在会替换为 `end else begin ... end`，不会将后续普通语句错误包含进 `else` 分支。
- 新增该场景的回归测试，覆盖连续赋值语句不会被误包裹的问题。

## 1.3.3

- 在主 README 中新增英文功能说明与快速使用指南。
- 更新 Marketplace 英文简介。

## 1.3.2

### 更新报告

- 修复候选文件写入临时目录后，Vivado `xvlog` 无法解析源文件同目录 `include` 文件的问题。
- 校验时自动将源文件所在目录通过 `-i` 传给 `xvlog`。
- 递归收集相对路径与嵌套 `include` 文件所在目录，例如 `include "..\\qwe\\reg_define.v"` 及其二级包含文件。
- 新增 `verilog-helper.vivadoIncludePaths`，用于配置工程中额外的 `include` 搜索目录。
- Vivado 日志新增本次实际使用的 include 搜索目录，方便定位工程路径配置问题。

## 1.3.1

- 补充 GitHub 源码仓库、Issue 反馈入口与联系邮箱。

## 1.3.0

- 自动补充 Verilog / SystemVerilog 控制语句缺失的 `begin` / `end`。
- 在写入文件前使用 Vivado `xvlog` 校验候选代码。
- 校验日志包含 Vivado 输出及转换后的完整文件，并在每次运行时覆盖。
