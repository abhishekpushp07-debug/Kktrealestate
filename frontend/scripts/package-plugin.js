/* Webpack plugin: after a production build is emitted, package all three surfaces into build/.
   Root ERP js/css are kept until process exit so react-scripts can still print its size report. */
const { packageBuild, cleanRoot } = require("./package-build");

class KktPackagePlugin {
  apply(compiler) {
    if (compiler.options.mode !== "production") return;
    compiler.hooks.done.tap("KktPackagePlugin", (stats) => {
      if (stats.hasErrors()) return;
      packageBuild({ clean: false });
      process.once("exit", () => { try { cleanRoot(); } catch (e) { console.error(`[package] cleanup failed: ${e.message}`); } });
    });
  }
}

module.exports = KktPackagePlugin;
