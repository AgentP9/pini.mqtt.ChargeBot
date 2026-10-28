'use strict';

/**
 * Parse appliance configurations from the MQTT_APPLIANCES environment variable.
 *
 * Format: "Name:topic" or "Name:topic:notifyTopic"
 *   - topic      : MQTT topic prefix; the backend subscribes to {topic}/relay/0/power
 *   - notifyTopic: where to publish the cycle-complete notification;
 *                  defaults to "{topic}/notify" when omitted
 *
 * Multiple appliances are separated by commas.
 *
 * @param {string} configString - Raw environment variable value
 * @returns {Array<{name: string, topic: string, notifyTopic: string, id: string}>}
 */
function parseApplianceConfig(configString) {
  if (!configString) return [];

  return configString.split(',').map(item => {
    const trimmed = item.trim();
    if (!trimmed) return null;

    const colonIndex = trimmed.indexOf(':');
    if (colonIndex === -1) return null;

    const name = trimmed.slice(0, colonIndex).trim();
    const rest = trimmed.slice(colonIndex + 1).trim();
    const secondColonIndex = rest.indexOf(':');

    let topic, notifyTopic;
    if (secondColonIndex === -1) {
      topic = rest;
      notifyTopic = `${topic}/notify`;
    } else {
      topic = rest.slice(0, secondColonIndex).trim();
      notifyTopic = rest.slice(secondColonIndex + 1).trim();
    }

    return { name, topic, notifyTopic, id: topic.replace(/\//g, '_') };
  }).filter(Boolean);
}

module.exports = { parseApplianceConfig };
