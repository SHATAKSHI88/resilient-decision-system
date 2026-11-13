const { dbState } = require('../config/db');

exports.getHealth = (req, res) => {
  const database = dbState();
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      database, // real mongoose connection state
      // The verification dependency is simulated locally; details: GET /api/dependencies/verification
      externalDependencies: 'simulated',
      retryWorker: require('../services/retryWorker').worker.getStatus(), // Phase 9: polling worker for automatic retries
    },
  });
};
