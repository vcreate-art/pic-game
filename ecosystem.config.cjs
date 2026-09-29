module.exports = {
  apps: [
    {
      name: 'pic-game',
      script: 'apps/server/dist/index.js',
      cwd: __dirname,
      env: { NODE_ENV: 'production' },
      node_args: '--enable-source-maps',
    },
  ],
};
