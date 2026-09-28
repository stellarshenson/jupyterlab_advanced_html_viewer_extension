import { URLExt } from '@jupyterlab/coreutils';

import { ServerConnection } from '@jupyterlab/services';

/**
 * What the server extension answered: the response and its body, parsed
 * where it was JSON and left as text where it was not.
 */
export interface IAnswer {
  response: Response;
  data: any;
}

/**
 * Call the server extension and answer with whatever it said.
 *
 * The status is left to the caller: the write route says what it did through
 * a 409, and an absent server extension answers 404 with the server's HTML
 * page, where a served 404 carries JSON.
 *
 * @param endPoint API REST end point for the extension
 * @param serverSettings The server settings to use for the request
 * @param init Initial values for the request
 */
export async function fetchAPI(
  endPoint: string,
  serverSettings: ServerConnection.ISettings,
  init: RequestInit = {}
): Promise<IAnswer> {
  const requestUrl = URLExt.join(
    serverSettings.baseUrl,
    'jupyterlab-advanced-html-viewer-extension',
    endPoint
  );

  let response: Response;
  try {
    response = await ServerConnection.makeRequest(
      requestUrl,
      init,
      serverSettings
    );
  } catch (error) {
    throw new ServerConnection.NetworkError(error as any);
  }

  let data: any = await response.text();
  if (data.length > 0) {
    try {
      data = JSON.parse(data);
    } catch {
      // Left as text: the server's own HTML page for an absent route.
    }
  }
  return { response, data };
}
