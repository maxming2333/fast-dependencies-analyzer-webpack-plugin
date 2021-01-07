const fs = require('fs');
const path = require('path');
const gonzales = require('gonzales-pe');
const minimatch = require('minimatch');
const grf = require('git-range-files');
const { merge } = require('webpack-merge');

module.exports = class FastDependenciesAnalyzerPlugin {
  constructor(options = {}) {
    this.context = null;
    this.options = merge({
      tree: false,                                                        // 是否生成依赖树
      reverse: false,                                                     // 是否翻转依赖表，（tree 为 true 时，此选项失效）
      relativePath: true,                                                 // 是否转换为相对路径
      analyzeGitCommitId: '',                                             // 自动分析 Git 提交文件 commit ID，如果为空，则认为是不需要自动分析
      analyzeTargetFile: 'root',                                          // 自动分析 Git 提交文件的时候，找到什么层级的影响文件，这是一个 minimatch 配置
      output: {
        dependencies: './fast-dependencies-analyzer.json',                // 输出依赖表的文件地址
        analyzeGitResult: './fast-dependencies-analyzer-git-result.json', // 输出分析 Git 提交结果的文件地址
      },
    }, options);
    this.__tapCount = 0;
    this.tmpDependencies = {};
    this.dependencies = {};
    this.allFileList = new Set();
    this.gitCommitFileList = [];
    
    // 如果要生成树，那么翻转将会无效
    if (this.options.tree) {
      this.options = merge(this.options, {
        reverse: false,
      });
    }

    if (this.options.analyzeGitCommitId) {
      this.options = merge(this.options, {
        tree: false,
        reverse: true,
        relativePath: true,
      });
    }
  }
  
  skip(filePath) {
    return filePath && filePath.includes("node_modules");
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
  
  getCssDependencies(filePath) {
    let ret = [];
    const content = fs.readFileSync(filePath).toString();
    const extname = path.extname(filePath).replace(/^\./ig, '');
    const parseTree = gonzales.parse(content, { syntax: extname });
    parseTree.eachFor('atrule', function(atruleNode) {
      atruleNode.eachFor('string', function(node) {
        ret.push(node.content.replace(/'|"/ig, ''));
      });
    });
    return ret.map(item => {
      const requireId = path.join('./', item);
      return require.resolve(`./${requireId}`, { paths: [ path.dirname(filePath) ] });
    });
  }
  
  analyzeCss(filePath, ret = []) {
    const dependencies = this.getCssDependencies(filePath);
    dependencies.forEach(item => {
      ret.push([filePath, item]);
      this.analyzeCss(item, ret);
    });
    return ret;
  }
  
  generateDependencies (issuer, requireFile) {
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
  
  findTargetNode(type = 'root', filePath, targetNodeList) {
    filePath = this.conversionFilePath(filePath);
    targetNodeList = targetNodeList || (new Set());
    // 如果根本不在依赖表里面，那么就直接返回
    if (!this.allFileList.has(filePath)) return;
    if (!this.options.tree) {
      if (this.options.reverse) {
        const parents = this.dependencies[filePath];
        const isSelf = type === 'root' ? !parents : minimatch(filePath, type);
        if (isSelf) {
          targetNodeList.add(filePath);
          return;
        }
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
      const nodeList = this.findTargetNode(this.options.analyzeTargetFile, file);
      ret = ret.concat(nodeList);
    });
    return [...new Set(ret)].filter(item => !!item);
  }
  
  getGitCommitFileList(head) {
    return new Promise((resolve, reject) => {
      grf({ head, relative: false }, function(err, results){
        if (err) return reject(err);
        resolve(results);
      });
    });
  }

  afterResolve = (result, callback) => {
    const issuer = result.resourceResolveData.context.issuer;
    const filePath = result.resourceResolveData.path;

    if (issuer !== filePath && !this.skip(issuer) && !this.skip(filePath)) {
      this.generateDependencies(issuer, filePath);
        if (/\S+\.s(a|c)ss$/i.test(filePath)) {
          const cssdDependencies = this.analyzeCss(filePath);
          cssdDependencies.forEach(item => {
            const [ issuer, filePath ] = item;
            this.generateDependencies(issuer, filePath);
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
      if (this.options.analyzeGitCommitId) {
        const result = this.analyzeGitCommit();
        if (this.options.output.analyzeGitResult) {
          fs.writeFileSync(this.options.output.analyzeGitResult, JSON.stringify(result, null, 2));
        }
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
    this.context = compiler.context;

    compiler.hooks.normalModuleFactory.tap("FastDependenciesAnalyzerPlugin", nmf => {
      nmf.hooks.afterResolve.tapAsync("FastDependenciesAnalyzerPlugin", this.afterResolve);
    });

    compiler.hooks.compilation.tap("FastDependenciesAnalyzerPlugin", compilation => {
      this.__tapCount += 1;
      compilation.hooks.finishModules.tapAsync("FastDependenciesAnalyzerPlugin", this.handleFinishModules);
    });
    
    if (this.options.analyzeGitCommitId) {
      const fileList = await this.getGitCommitFileList(this.options.analyzeGitCommitId);
      fileList.forEach(filePath => {
        this.gitCommitFileList.push(filePath.filename);
      });
      console.log(`获取 Commit ID: ${this.options.analyzeGitCommitId} 所修改的文件列表如下：\n`, this.gitCommitFileList);
    }
  }
}