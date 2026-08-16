/**
 * Manual mock for lucide-react.
 * lucide-react ships as ESM and Jest's jsdom environment cannot parse it
 * without custom transforms. This mock provides all icons used in the project
 * as simple span elements for testing.
 */

const React = require("react");

function createMockIcon(name) {
  const Icon = React.forwardRef((props, ref) =>
    React.createElement("span", { ...props, ref, "data-testid": `icon-${name}` })
  );
  Icon.displayName = name;
  return Icon;
}

// Export all icons used across the project
module.exports = new Proxy(
  {},
  {
    get: function (_target, prop) {
      if (prop === "__esModule") return true;
      if (typeof prop === "string") {
        return createMockIcon(prop);
      }
      return undefined;
    },
  }
);
