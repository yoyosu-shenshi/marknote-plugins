// 最小可用插件模板 —— 复制此文件改 id/name 即可开发你自己的插件。
// 约定：导出 default 必须是一个对象，且含 activate(api) 方法。
// 服务端安装时会把本文件下载到用户目录，前端运行时 import 并调用 activate(api)。
export default {
  id: "example-hello",
  name: "示例：Hello 插件",
  version: "0.1.0",

  // api 提供：api.plugins()、api.registerBlockRenderer(type, fn)、
  // api.on(event, fn)、api.addCommand(...)、api.toast(msg) 等钩子
  activate(api) {
    console.log("[example-hello] 插件已启用");
    // 例：注册一个自定义块渲染器（在 ```hello 代码块里生效）
    if (typeof api.registerBlockRenderer === "function") {
      api.registerBlockRenderer("hello", (el, block) => {
        el.textContent = "Hello from plugin: " + (block.text || "");
      });
    }
    if (typeof api.toast === "function") {
      api.toast("示例插件已加载 👋");
    }
  },

  // 可选：停用时的清理
  deactivate() {
    console.log("[example-hello] 插件已停用");
  },
};
