const fs = require('fs');
const path = require('path');
const gonzales = require('gonzales-pe');
const grf = require('git-range-files');
const { mergeWithCustomize, customizeArray } = require('webpack-merge');

module.exports = {
  merge: mergeWithCustomize({
    customizeArray: customizeArray({
      '*': 'replace'
    })
  }),
  skip(filePath) {
    return filePath && filePath.includes('node_modules');
  },
  getCssDependencies(filePath) {
    let ret = [];
    const content = fs.readFileSync(filePath).toString();
    const extname = path.extname(filePath).replace(/^\./ig, '');
    const parseTree = gonzales.parse(content, { syntax: extname });
    parseTree.eachFor('atrule', (atruleNode) => {
      atruleNode.eachFor('string', (node) => {
        ret.push(node.content.replace(/'|"/ig, ''));
      });
    });
    return ret.map(item => {
      const requireId = path.join('./', item);
      return require.resolve(`./${requireId}`, { paths: [path.dirname(filePath)] });
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
  }
};
