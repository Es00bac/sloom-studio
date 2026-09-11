const projectSchemaManifest = require('../shared/project-schema.json');

const CURRENT_PROJECT_SCHEMA_VERSION = projectSchemaManifest.schemaVersion;
const FLOW_NODE_TYPES = projectSchemaManifest.flowNodeTypes;

module.exports = {
  CURRENT_PROJECT_SCHEMA_VERSION,
  FLOW_NODE_TYPES,
};
