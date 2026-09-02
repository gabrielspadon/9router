const api = require("../api/client");

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m"
};

/**
 * Get endpoint URL based on tunnel status
 * @param {number} port - Local server port
 * @returns {Promise<{endpoint: string, tunnelEnabled: boolean}>}
 */
async function getEndpoint(port) {
  const result = await api.getTunnelStatus();
  const tunnelEnabled = result.success && result.data?.enabled === true;
  // The short link is withheld while the relay does not serve it (#1365), and
  // the direct tunnel URL is still the reachable one then -- falling straight
  // back to localhost would hand out an address nobody outside can use.
  const remoteUrl = result.success ? result.data?.publicUrl || result.data?.tunnelUrl : "";

  const endpoint = tunnelEnabled && remoteUrl ? `${remoteUrl}/v1` : `http://localhost:${port}/v1`;
  return { endpoint, tunnelEnabled };
}

/**
 * Get endpoint with color formatting
 * @param {number} port - Local server port
 * @returns {Promise<string>} Colored endpoint string
 */
async function getEndpointColored(port) {
  const { endpoint, tunnelEnabled } = await getEndpoint(port);
  return tunnelEnabled ? `${COLORS.green}${endpoint}${COLORS.reset}` : endpoint;
}

module.exports = { getEndpoint, getEndpointColored };
