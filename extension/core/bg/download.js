/*
 * Copyright 2010-2019 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 * 
 * This file is part of SingleFile.
 *
 *   SingleFile is free software: you can redistribute it and/or modify
 *   it under the terms of the GNU Lesser General Public License as published by
 *   the Free Software Foundation, either version 3 of the License, or
 *   (at your option) any later version.
 *
 *   SingleFile is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *   GNU Lesser General Public License for more details.
 *
 *   You should have received a copy of the GNU Lesser General Public License
 *   along with SingleFile.  If not, see <http://www.gnu.org/licenses/>.
 */

/* global browser, singlefile, Blob, URL */

singlefile.download = (() => {

	const partialContents = new Map();

	browser.runtime.onMessage.addListener((request, sender) => {
		if (request.download) {
			try {
				if (request.truncated) {
					let partialContent = partialContents.get(sender.tab.id);
					if (!partialContent) {
						partialContent = [];
						partialContents.set(sender.tab.id, partialContent);
					}
					partialContent.push(request.content);
					if (request.finished) {
						partialContents.delete(sender.tab.id);
						request.url = URL.createObjectURL(new Blob(partialContent, { type: "text/html" }));
					} else {
						return Promise.resolve({});
					}
				} else if (request.content) {
					request.url = URL.createObjectURL(new Blob([request.content], { type: "text/html" }));
				}
				return downloadPage(request, { confirmFilename: request.confirmFilename, incognito: sender.tab.incognito, conflictAction: request.filenameConflictAction })
					.catch(error => {
						if (error.message && error.message.includes("'incognito'")) {
							return downloadPage(request, { confirmFilename: request.confirmFilename, conflictAction: request.filenameConflictAction });
						} else {
							return { notSupported: true };
						}
					});
			} catch (error) {
				return Promise.resolve({ notSupported: true });
			}
		}
	});

	return { downloadPage };

	async function downloadPage(page, options) {
		const downloadInfo = {
			url: page.url,
			saveAs: options.confirmFilename,
			filename: page.filename,
			conflictAction: options.filenameConflictAction
		};
		if (options.incognito) {
			downloadInfo.incognito = true;
		}
		const downloadId = await browser.downloads.download(downloadInfo);
		return new Promise((resolve, reject) => {
			browser.downloads.onChanged.addListener(onChanged);

			function onChanged(event) {
				if (event.id == downloadId && event.state) {
					if (event.state.current == "complete") {
						URL.revokeObjectURL(page.url);
						resolve({});
						browser.downloads.onChanged.removeListener(onChanged);
					}
					if (event.state.current == "interrupted" && (!event.error || event.error.current != "USER_CANCELED")) {
						URL.revokeObjectURL(page.url);
						reject(new Error(event.state.current));
						browser.downloads.onChanged.removeListener(onChanged);
					}
				}
			}
		});
	}

})();
