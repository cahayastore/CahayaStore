module.exports = {
  apps: [
    {
      name: 'cahayastore-api',
      cwd: '/root/cahayastore/backend',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3100
      },
      max_memory_restart: '512M'
    }
  ]
};
