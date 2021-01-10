module.exports = {
  root: true,
  env: {
    node: true,
    mocha: true,
    es6: true
  },
  parser: 'babel-eslint',
  extends: ['airbnb-base/legacy'],
  parserOptions: {
    ecmaVersion: 6,
    sourceType: 'module',
    ecmaFeatures: {
      modules: true,
      experimentalObjectRestSpread: true
    }
  },
  rules: {
    'no-underscore-dangle': ['off'],
    'no-param-reassign': ['off'],
    'consistent-return': ['off'],
    'max-len': ['off'],
    'no-console': ['off']
  }
};
