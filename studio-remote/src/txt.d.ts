// 自托管静态资源以文本模块引入（Leaflet 等）
declare module '*.txt' {
  const content: string;
  export default content;
}
