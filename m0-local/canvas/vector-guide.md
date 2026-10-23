# 高级矢量数据与几何

文档仍为 `m0-local-canvas-v1`、`version:2`；旧版图层字段和页面结构继续保留。新增 `type:'path'`，以及所有图层共有的 `rotation`（度）、`flipX`、`flipY` 和可选 `gradient`。

```js
{
  type: 'path', x: 10, y: 20, width: 160, height: 100,
  path: {
    width: 160, height: 100, fillRule: 'nonzero',
    contours: [{
      closed: true,
      points: [
        {x: 0, y: 50, in: {x: 0, y: 0}, out: {x: 0, y: -50}, mode: 'corner'},
        {x: 160, y: 50, in: {x: 0, y: -50}, out: {x: 0, y: 0}, mode: 'corner'}
      ]
    }]
  },
  gradient: {
    type: 'linear', from: {x: 0, y: 0}, to: {x: 1, y: 1},
    stops: [{offset: 0, color: '#ff0000'}, {offset: 1, color: '#0000ff'}]
  }
}
```

`in` / `out` 是相对锚点的控制柄偏移，`mode` 为 `corner`、`smooth` 或 `symmetric`。路径可有多个轮廓与孔，填充规则支持 `nonzero` / `evenodd`。`path.width/height` 是几何基准尺寸；修改图层 `width/height` 时按比例渲染，原控制点不被破坏。渐变起止点使用图层包围盒归一化坐标，允许越界端点。

`model.mjs` 导出的纯辅助函数接受 path 或完整 path 图层。传入完整图层时，显示坐标和控制柄编辑会自动换算尺寸缩放。辅助函数返回新的 path，输入不变：

- `pathToSVGData(input)`；`getPathAnchors(input)`，后者返回显示坐标的锚点和绝对控制柄位置。
- `movePathAnchor(input, contourIndex, pointIndex, {x,y})`。
- `movePathHandle(input, contourIndex, pointIndex, 'in'|'out', {x,y}, {mirror})`。
- `appendPathPoint(input, {x,y}, contourIndex=0)`、`removePathPoint(input, ci, pi)`、`setPathClosed(input, ci, closed)`。
- `insertPathPoint(input, ci, segmentIndex, t=.5)` 用 De Casteljau 分割三次贝塞尔，保持原曲线。
- `nodeTransformSVG(node)` 给出围绕图层中心的旋转/翻转变换；外层仍负责 `translate(node.x,node.y)`。

以下函数修改传入文档并返回结果图层 id：`convertNodeToPath(doc,id)`、`normalizePathBounds(doc,id)`、`booleanNodes(doc,ids,operation)`、`flattenNode(doc,id,{tolerance})`。

`booleanNodes` 的 `union` / `subtract` / `intersect` / `exclude` 运行真正的曲线路径布尔运算。形状须处于同一父图层、未锁定且轮廓闭合，当前支持矩形、椭圆与 path；失败或空结果保留原图层。`flatten` 则合成多轮廓并保留贝塞尔，不做并集。单独的 `flattenNode` 是按容差转成折线的底层 API，与界面的保曲线“展平”不同。

几何采用固定 [Paper.js 0.12.18](https://github.com/paperjs/paper.js/tree/v0.12.18)，其 [PathItem 官方文档](https://paperjs.org/reference/pathitem/) 提供曲线布尔 API。[MIT 许可证](vendor/paper-0.12.18/LICENSE.txt)、来源、压缩包 SHA-256 和各文件 SHA-256 保存在 `vendor/paper-0.12.18/manifest.json`。浏览器版本仅在原 minified core 后附加 `export default paper`；算法未修改。运行不需要 CDN 或 Figma 登录。

`importSVG(source)` 是不执行 SVG 的严格解析器。支持 path（包括 Q/A 转为 C）、rect、ellipse、circle、line、polygon/polyline、分组 transform 和 objectBoundingBox 线性渐变；拒绝脚本、事件、实体、foreignObject、外部引用和图片。其余不支持元素/样式明确报错。SVG 组透明度会分配至路径，并提示重叠区域的隔离混合差异。导出直接由已验证的图层数据生成 SVG，不保留导入的原始 XML。

本地 Figma REST JSON 中有 `fillGeometry` 或 `strokeGeometry` 时，按真实路径导入，支持 `size` / `relativeTransform` 和线性渐变。按 [Figma 官方定义](https://developers.figma.com/docs/rest-api/file-node-types/)，这些几何数据需要原导出包含 `geometry=paths`；缺失数据时仍给出明确边界警告，不能从矩形边界推断原矢量。未接远端账号、`.fig` 二进制、完整效果、径向渐变或填充覆盖表。

原 KRN 不支持 path，并会忽略普通 `styles.transform`。因此矢量、渐变及旋转/翻转后的矢量叶子会生成确定命名的本地 `canvas-vector-<sha256>.svg`，沿原图片节点生成代码，图形变换已烘入 SVG，素材与布局尺寸一致。`extractCanvasAssets` 提供实际 SVG 字节；元数据注明目标平台须支持 SVG 图片。旋转文字、图片、有子图层容器或非矢量渐变若不能保持语义，会拒绝 KRN 转换并建议 SVG 导出，避免返回缺失视觉效果的成功结果。SVG 文档导出仍保留这些图层变换。

验证：`node --test canvas/vector.test.mjs`，以及已有 `node canvas/test-canvas.mjs`。新增测试覆盖依赖哈希、路径编辑、曲线插点保持面积、四种真实布尔、孔/复合路径、变换后标准化、SVG 安全边界、Figma 几何，以及原 KRN 的真实 SVG 素材引用。
