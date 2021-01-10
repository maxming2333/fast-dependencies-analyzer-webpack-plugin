# fast-dependencies-analyzer-webpack-plugin

[![npm](https://img.shields.io/npm/v/fast-dependencies-analyzer-webpack-plugin.svg)](https://www.npmjs.com/package/fast-dependencies-analyzer-webpack-plugin)
[![npm](https://img.shields.io/node/v/fast-dependencies-analyzer-webpack-plugin.svg)](https://www.npmjs.com/package/fast-dependencies-analyzer-webpack-plugin)
[![npm](https://img.shields.io/npm/dt/fast-dependencies-analyzer-webpack-plugin.svg)](https://www.npmjs.com/package/fast-dependencies-analyzer-webpack-plugin)
[![npm](https://img.shields.io/npm/dm/fast-dependencies-analyzer-webpack-plugin.svg)](https://www.npmjs.com/package/fast-dependencies-analyzer-webpack-plugin)
[![npm](https://img.shields.io/github/stars/maxming2333/fast-dependencies-analyzer-webpack-plugin.svg?style=social&label=Star)](https://github.com/maxming2333/fast-dependencies-analyzer-webpack-plugin) 

-----

> Can fast analyze webpack file dependencies

[![NPM](https://nodei.co/npm-dl/fast-dependencies-analyzer-webpack-plugin.png)](https://nodei.co/npm/fast-dependencies-analyzer-webpack-plugin/)

[![NPM](https://nodei.co/npm/fast-dependencies-analyzer-webpack-plugin.png?downloads=true&downloadRank=true&stars=true)](https://nodei.co/npm/fast-dependencies-analyzer-webpack-plugin/)

-----

本插件有以下功能：
- 快速分析 webpack 项目文件依赖，并生成依赖表
    - 依赖表类型：树形结构、扁平化、反向扁平化
    - 根据 webpack config context，输出 绝对 / 相对路径
-  自动分析 Git 修改文件所引起的入口文件变化
    - 查找影响类型：入口文件、符合 `minimatch` 规则匹配的文件
    - 根据 webpack config context，输出 绝对 / 相对路径

**注意：** 这里仅分析项目文件，所以项目依赖 `node_modules` 里面的模块会被忽略



## usage


**install**

```bash
npm install fast-dependencies-analyzer-webpack-plugin --save-dev
```

**use**

请参阅 [lib/index.js](lib/index.js) `this.options` 注释（暂时没时间详细写明，看一下注释吧）
