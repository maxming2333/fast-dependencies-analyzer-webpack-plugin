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
        dependencies: '',                                                // 输出依赖表的文件地址 (string/function)
        analyzeGitResult: ''                                             // 输出分析 Git 提交结果的文件地址 (string/function)
      },
      finishHandler: null
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
      const len = commitRange.length;
      this.options.analyzeGitInfo.commitRange = len === 1 ? [`${commitRange[0]}~1`, `${commitRange[0]}`] : [commitRange[len - 1], commitRange[0]];
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
        this.dependencies[requireFile] = util.addDependencies(this.dependencies[requireFile], issuer);
      } else {
        this.dependencies[issuer] = util.addDependencies(this.dependencies[issuer], requireFile);
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

  findTargetNode(type, filePath, findNodeList, targetNodeList) {
    if (!type) return;
    filePath = this.conversionFilePath(filePath);
    findNodeList = findNodeList || (new Set()); // 存储经过查找的节点，防止循环依赖导致的死循环
    targetNodeList = targetNodeList || (new Set()); // 存储查找到的节点，用于输出
    if ((!this.options.tree && this.options.reverse) && this.allFileList.has(filePath) && !findNodeList.has(filePath)) {
      findNodeList.add(filePath);
      const isMatch = this.checkMinimatch(type, filePath);
      if (isMatch) {
        targetNodeList.add(filePath);
      }
      // 尝试继续往上查找
      const parents = this.dependencies[filePath];
      if (parents) {
        parents.forEach(item => {
          this.findTargetNode(type, item, findNodeList, targetNodeList);
        });
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

  async outputDependencies(result) {
    if (!this.options.output.dependencies) return;
    if (typeof this.options.output.dependencies === 'string') {
      this.options.output.dependencies = this.conversionFilePath(this.options.output.dependencies, false);
      try {
        fs.writeFileSync(this.options.output.dependencies, JSON.stringify(result, null, 2));
      } catch (err) {
        if (this.options.tree) {
          err.message = `已生成依赖树，但是无法输出依赖树，JSON 序列化失败，请确认项目是否有循环依赖问题.\n${err.message}`;
        }
        throw err;
      }
    } else if (typeof this.options.output.dependencies === 'function') {
      await this.options.output.dependencies(result);
    }
  }

  async outputAnalyzeGitResult(result) {
    if (!this.options.output.analyzeGitResult) return;
    if (typeof this.options.output.analyzeGitResult === 'string') {
      this.options.output.analyzeGitResult = this.conversionFilePath(this.options.output.analyzeGitResult, false);
      fs.writeFileSync(this.options.output.analyzeGitResult, JSON.stringify(result, null, 2));
    } else if (typeof this.options.output.analyzeGitResult === 'function') {
      await this.options.output.analyzeGitResult(result);
    }
  }

  async afterResolve(result, callback) {
    const issuer = result.resourceResolveData.context.issuer;
    const filePath = result.resourceResolveData.path;

    if (issuer !== filePath && !util.skip(issuer) && !util.skip(filePath)) {
      this.generateDependencies(issuer, filePath);
      if (util.isSass(filePath) || util.isLess(filePath)) {
        const cssdDependencies = this.analyzeCss(filePath);
        cssdDependencies.forEach(item => {
          const [itemIssuer, itemFilePath] = item;
          this.generateDependencies(itemIssuer, itemFilePath);
        });
      }
    }
    callback();
  }

  async handleFinishModules(modules, callback) {
    this.__tapCount -= 1;
    if (this.__tapCount <= 0) {
      if (this.options.analyzeGitInfo.enable) {
        const result = {
          change_info: {
            commit_range: this.options.analyzeGitInfo.commitRange,
            files: this.gitCommitFileList
          },
          analyze_result: this.analyzeGitCommit()
        };
        await this.outputAnalyzeGitResult(result);
      }
      await this.outputDependencies(this.dependencies);
    }
    let finishResult = 'After the FastDependenciesAnalyzerPlugin analysis is completed, stop actively.';
    if (this.options.finishHandler) {
      finishResult = this.options.finishHandler.apply(this);
    }
    callback(finishResult);
  }

  async apply(compiler) {
    // 删除 css loader 配置
    compiler.options = util.removeCssLoader(compiler.options);

    this.context = compiler.options.context;
    this.entryList = util.getEntryList(compiler.options).map(entry => this.conversionFilePath(entry));

    compiler.hooks.normalModuleFactory.tap('FastDependenciesAnalyzerPlugin', nmf => {
      nmf.hooks.afterResolve.tapAsync('FastDependenciesAnalyzerPlugin', this.afterResolve.bind(this));
    });

    compiler.hooks.compilation.tap('FastDependenciesAnalyzerPlugin', compilation => {
      this.__tapCount += 1;
      compilation.hooks.finishModules.tapAsync('FastDependenciesAnalyzerPlugin', this.handleFinishModules.bind(this));
    });

    if (this.options.analyzeGitInfo.enable) {
      const fileList = await util.getGitCommitFileList(this.options.analyzeGitInfo.commitRange.join(' '));
      const filterFileList = await this.options.analyzeGitInfo.fileFilter(fileList);
      this.gitCommitFileList = filterFileList.map(filePath => filePath.filename);
    }
  }
};
