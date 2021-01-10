const fs = require('fs');
const path = require('path');
const minimatch = require('minimatch');

const util = require('./util');

module.exports = class FastDependenciesAnalyzerPlugin {
  constructor(options = {}) {
    this.context = null;
    this.entryList = [];

    /* eslint-disable no-multi-spaces */
    this.options = util.merge({
      tree: false,                                                       // 是否生成依赖树
      reverse: false,                                                    // 是否翻转依赖表，（tree 为 true 时，此选项失效）
      relativePath: true,                                                // 是否转换为相对路径
      analyzeGitInfo: {
        enable: false,                                                   // 是否开启 自动分析 Git 提交文件
        commitRange: [],                                                 // 自动分析 commit ID 范围，如果为空，则是当下 git head
        fileFilter: async (files) => (files),                            // 自动分析 git 文件修改列表 过滤函数，用于丢弃影响分析正确性的文件
        targetFiles: [                                                   // 自动分析 Git 提交文件的时候，找到什么层级的影响文件，这是一个 minimatch 配置
          'entry'                                                        // 会逐个 minimatch 查找，直到查找到 minimatch 匹配到文件，才会结束（Array.prototype.some 操作）
        ]
      },
      output: {
        dependencies: './fast-dependencies-analyzer.json',               // 输出依赖表的文件地址
        analyzeGitResult: './fast-dependencies-analyzer-git-result.json' // 输出分析 Git 提交结果的文件地址
      }
    }, options);
    /* eslint-enable no-multi-spaces */

    this.__tapCount = 0;
    this.tmpDependencies = {};
    this.dependencies = {};
    this.allFileList = new Set();
    this.gitCommitFileList = [];

    // 如果要生成树，那么翻转将会无效
    if (this.options.tree) {
      this.options = util.merge(this.options, {
        reverse: false
      });
    }

    // 如果需要进行 git 分析
    if (this.options.analyzeGitInfo.enable) {
      const commitRange = this.options.analyzeGitInfo.commitRange.filter(item => !!item);
      if (!commitRange.length) {
        const head = util.getGitHead();
        commitRange.push(head);
      }
      this.options = util.merge(this.options, {
        tree: false,
        reverse: true,
        relativePath: true
      });
      // commitRange 合规
      this.options.analyzeGitInfo.commitRange = commitRange.length === 1 ? [`${commitRange[0]}~1`, `${commitRange[0]}`] : commitRange.slice(0, 2);
    }
  }

  conversionFilePath(filePath, conversionRelative) {
    if (!filePath) return filePath;
    const isAbsolute = path.isAbsolute(filePath);
    conversionRelative = typeof conversionRelative === 'undefined' ? this.options.relativePath : conversionRelative;
    if (conversionRelative) {
      return path.relative(this.context, filePath);
    }
    return isAbsolute ? filePath : path.join(this.context, filePath);
  }

  analyzeCss(filePath, ret = []) {
    const dependencies = util.getCssDependencies(filePath);
    dependencies.forEach(item => {
      ret.push([filePath, item]);
      this.analyzeCss(item, ret);
    });
    return ret;
  }

  generateDependencies(issuer, requireFile) {
    issuer = this.conversionFilePath(issuer);
    requireFile = this.conversionFilePath(requireFile);
    if (!this.options.tree) {
      if (this.options.reverse) {
        this.dependencies[requireFile] = (this.dependencies[requireFile] || []).concat(issuer);
      } else {
        this.dependencies[issuer] = (this.dependencies[issuer] || []).concat(requireFile);
      }
    } else {
      this.tmpDependencies[requireFile] = this.tmpDependencies[requireFile] || {};
      if (issuer) {
        this.tmpDependencies[issuer] = this.tmpDependencies[issuer] || {};
        this.tmpDependencies[issuer][requireFile] = this.tmpDependencies[requireFile];
      }
      // 入口文件特征，设定为根节点
      if (issuer === '' && requireFile) {
        this.dependencies[requireFile] = this.tmpDependencies[requireFile];
      }
    }
    this.allFileList.add(issuer).add(requireFile);
  }

  checkMinimatch(type, filePath) {
    if (type === 'entry') {
      return this.entryList.includes(filePath);
    }
    return minimatch(filePath, type);
  }

  findTargetNode(type, filePath, targetNodeList) {
    if (!type) return;
    filePath = this.conversionFilePath(filePath);
    targetNodeList = targetNodeList || (new Set());
    // 如果根本不在依赖表里面，那么就直接返回
    if (!this.allFileList.has(filePath)) return;
    if (!this.options.tree) {
      if (this.options.reverse) {
        const isMatch = this.checkMinimatch(type, filePath);
        if (isMatch) {
          targetNodeList.add(filePath);
          return;
        }
        // 当前层查不到，继续往上查找
        const parents = this.dependencies[filePath];
        if (parents) {
          parents.forEach(item => {
            this.findTargetNode(type, item, targetNodeList);
          });
        }
      }
    }
    return [...targetNodeList];
  }

  analyzeGitCommit() {
    let ret = [];
    this.gitCommitFileList.forEach(file => {
      this.options.analyzeGitInfo.targetFiles.some(targetFile => {
        const nodeList = this.findTargetNode(targetFile, file);
        if (nodeList && nodeList.length) {
          ret = ret.concat(nodeList);
          return true;
        }
        return false;
      });
    });
    return [...new Set(ret)].filter(item => !!item);
  }

  afterResolve = (result, callback) => {
    const issuer = result.resourceResolveData.context.issuer;
    const filePath = result.resourceResolveData.path;

    if (issuer !== filePath && !util.skip(issuer) && !util.skip(filePath)) {
      this.generateDependencies(issuer, filePath);
      if (/\S+\.s(a|c)ss$/i.test(filePath)) {
        const cssdDependencies = this.analyzeCss(filePath);
        cssdDependencies.forEach(item => {
          const [itemIssuer, itemFilePath] = item;
          this.generateDependencies(itemIssuer, itemFilePath);
        });
      }
    }
    callback();
  }

  handleFinishModules = (modules, callback) => {
    this.__tapCount -= 1;
    if (this.__tapCount <= 0) {
      this.options.output.dependencies = this.conversionFilePath(this.options.output.dependencies, false);
      this.options.output.analyzeGitResult = this.conversionFilePath(this.options.output.analyzeGitResult, false);
      if (this.options.analyzeGitInfo.enable && this.options.output.analyzeGitResult) {
        const result = {
          change_info: {
            commit_range: this.options.analyzeGitInfo.commitRange,
            files: this.gitCommitFileList
          },
          analyze_result: this.analyzeGitCommit()
        };
        fs.writeFileSync(this.options.output.analyzeGitResult, JSON.stringify(result, null, 2));
      }
      if (this.options.output.dependencies) {
        try {
          fs.writeFileSync(this.options.output.dependencies, JSON.stringify(this.dependencies, null, 2));
        } catch (err) {
          if (this.options.tree) {
            err.message = `已生成依赖树，但是无法输出依赖树，JSON 序列化失败，请确认项目是否有循环依赖问题.\n${err.message}`;
          }
          throw err;
        }
      }
    }
    callback('After the FastDependenciesAnalyzerPlugin analysis is completed, stop actively.');
  }

  async apply(compiler) {
    this.context = compiler.options.context;
    this.entryList = util.getEntryList(compiler.options).map(entry => this.conversionFilePath(entry));

    compiler.hooks.normalModuleFactory.tap('FastDependenciesAnalyzerPlugin', nmf => {
      nmf.hooks.afterResolve.tapAsync('FastDependenciesAnalyzerPlugin', this.afterResolve);
    });

    compiler.hooks.compilation.tap('FastDependenciesAnalyzerPlugin', compilation => {
      this.__tapCount += 1;
      compilation.hooks.finishModules.tapAsync('FastDependenciesAnalyzerPlugin', this.handleFinishModules);
    });

    if (this.options.analyzeGitInfo.enable) {
      const fileList = await util.getGitCommitFileList(this.options.analyzeGitInfo.commitRange.join(' '));
      const filterFileList = await this.options.analyzeGitInfo.fileFilter(fileList);
      this.gitCommitFileList = filterFileList.map(filePath => filePath.filename);
    }
  }
};
