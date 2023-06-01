import { QuickPickItem } from "vscode";
interface IJupyterServerUri {
  baseUrl: string;
  token: string;
  authorizationHeader: any;
  expiration?: Date;
  displayName: string;
}
declare type JupyterServerUriHandle = string;
export interface IJupyterUriProvider {
  readonly id: string;
  getQuickPickEntryItems(): QuickPickItem[];
  handleQuickPick(
    item: QuickPickItem,
    backEnabled: boolean
  ): Promise<JupyterServerUriHandle | "back" | undefined>;
  getServerUri(handle: JupyterServerUriHandle): Promise<IJupyterServerUri>;
}
interface IDataFrameInfo {
  columns?: {
    key: string;
    type: ColumnType;
  }[];
  indexColumn?: string;
  rowCount?: number;
}
export interface IDataViewerDataProvider {
  dispose(): void;
  getDataFrameInfo(): Promise<IDataFrameInfo>;
  getAllRows(): Promise<IRowsResponse>;
  getRows(start: number, end: number): Promise<IRowsResponse>;
}
declare enum ColumnType {
  String = "string",
  Number = "number",
  Bool = "bool",
}
declare type IRowsResponse = any[];
export {};
