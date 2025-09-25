module.exports = {
  presets: [
    ['@babel/preset-react', { runtime: 'automatic' }],
    ['@babel/preset-env', {
      targets: {
        browsers: ['> 0.25%', 'not dead'],
      },
      browser: true,
    }],
  ],
  plugins: [
    '@babel/plugin-transform-runtime',
  ],
};
