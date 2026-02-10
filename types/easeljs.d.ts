// type errorを防ぐために作成
declare module '@createjs/easeljs' {
  const easeljs: any;
  export default easeljs;
}
