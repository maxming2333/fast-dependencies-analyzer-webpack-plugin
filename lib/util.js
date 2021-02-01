const fs = require('fs');
const path = require('path');
const gonzales = require('gonzales-pe');
const grf = require('git-range-files');
const { mergeWithCustomize, customizeArray } = require('webpack-merge');

const loaderOptions = {};

module.exports = {
  merge: mergeWithCustomize({
    customizeArray: customizeArray({
      '*': 'replace'
    })
  }),
  skip(filePath) {
    return filePath && filePath.includes('node_modules');
  },
  isSass(filePath) {
    return /\S+\.s(a|c)ss$/i.test(filePath);
  },
  isLess(filePath) {
    return /\S+\.less$/i.test(filePath);
  },
  getPaths(filePath) {
    if (this.isSass(filePath)) {
      return this.loaderOptions.sass.reduce((ret, item) => {
        if (item.sassOptions && item.sassOptions.includePaths) {
          ret.push(item.sassOptions.includePaths);
        }
        return ret;
      }, []).filter(item => !!item);
    }
    if (this.isLess(filePath)) {
      return this.loaderOptions.less.reduce((ret, item) => {
        if (item.lessOptions && item.lessOptions.paths) {
          ret.push(item.lessOptions.paths);
        }
        return ret;
      }, []).filter(item => !!item);
    }
  },
  getCssDependencies(filePath) {
    let ret = [];
    const content = fs.readFileSync(filePath).toString();
    const extname = path.extname(filePath).replace(/^\./ig, '');
    const parseTree = gonzales.parse(content, { syntax: extname });
    const paths = this.getPaths(filePath);
    parseTree.eachFor('atrule', (atruleNode) => {
      atruleNode.eachFor('string', (node) => {
        ret.push(node.content.replace(/'|"/ig, ''));
      });
    });
    return ret.map(item => {
      const requireId = path.join('./', item);
      return require.resolve(`./${requireId}`, { paths: [path.dirname(filePath), ...paths] });
    });
  },
  getGitHead() {
    return new Promise((resolve, reject) => {
      grf.getHead((err, head) => {
        if (err) return reject(err);
        resolve(head);
      });
    });
  },
  getGitCommitFileList(head) {
    return new Promise((resolve, reject) => {
      grf({ head }, (err, fileList) => {
        if (err) return reject(err);
        resolve(fileList);
      });
    });
  },
  getEntryList(config) {
    const entry = config.entry;
    if (typeof entry === 'string') {
      return [entry];
    }
    if (Array.isArray(entry)) {
      return [].concat(entry);
    }
    if (typeof entry === 'object') {
      return Object.values(entry);
    }
    return [];
  },
  addDependencies(dependencies, filePath) {
    dependencies = dependencies || [];
    if (filePath && !dependencies.includes(filePath)) {
      dependencies.push(filePath);
    }
    return dependencies;
  },
  get loaderOptions() {
    return loaderOptions;
  },
  removeCssLoader(webpackConfig) {
    webpackConfig.module.rules = webpackConfig.module.rules.filter((item) => {
      if (item.use) {
        return !item.use.some((loaderItem) => {
          const loader = typeof loaderItem === 'string' ? loaderItem : loaderItem.loader;
          const options = typeof loaderItem === 'string' ? undefined : loaderItem.options;
          const isSass = /sass-loader/i.test(loader);
          const isLess = /less-loader/i.test(loader);
          if (isSass) {
            loaderOptions.sass = loaderOptions.sass || [];
            if (options) {
              loaderOptions.sass.push(options);
            }
          }
          if (isLess) {
            loaderOptions.less = loaderOptions.less || [];
            if (options) {
              loaderOptions.less.push(options);
            }
          }
          return isSass || isLess;
        });
      }
      return true;
    });
    return webpackConfig;
  }
};
