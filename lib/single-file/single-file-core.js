/*
 * Copyright 2010-2019 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 * 
 * This file is part of SingleFile.
 *
 *   The code in this file is free software: you can redistribute it and/or 
 *   modify it under the terms of the GNU Affero General Public License 
 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
 *   of the License, or (at your option) any later version.
 * 
 *   The code in this file is distributed in the hope that it will be useful, 
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of 
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero 
 *   General Public License for more details.
 *
 *   As additional permission under GNU AGPL version 3 section 7, you may 
 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU 
 *   AGPL normally required by section 4, provided you include this license 
 *   notice and a URL through which recipients can access the Corresponding 
 *   Source.
 */

this.SingleFileCore = this.SingleFileCore || (() => {

	const SELECTED_CONTENT_ATTRIBUTE_NAME = "data-single-file-selected-content";
	const SELECTED_CONTENT_ROOT_ATTRIBUTE_NAME = "data-single-file-selected-content-root";
	const DEBUG = false;

	let DocUtil, cssTree, sessionId = 0;

	function getClass(...args) {
		[DocUtil, cssTree] = args;
		return SingleFileClass;
	}

	class SingleFileClass {
		constructor(options) {
			this.options = options;
			if (options.sessionId === undefined) {
				options.sessionId = sessionId;
				sessionId++;
			}
		}
		async initialize() {
			this.runner = new Runner(this.options, true);
			await this.runner.loadPage();
			await this.runner.initialize();
		}
		async run() {
			await this.runner.run();
		}
		async getPageData() {
			return this.runner.getPageData();
		}
	}

	SingleFileClass.SELECTED_CONTENT_ATTRIBUTE_NAME = SELECTED_CONTENT_ATTRIBUTE_NAME;
	SingleFileClass.SELECTED_CONTENT_ROOT_ATTRIBUTE_NAME = SELECTED_CONTENT_ROOT_ATTRIBUTE_NAME;

	// -------------
	// ProgressEvent
	// -------------
	const PAGE_LOADING = "page-loading";
	const PAGE_LOADED = "page-loaded";
	const RESOURCES_INITIALIZING = "resource-initializing";
	const RESOURCES_INITIALIZED = "resources-initialized";
	const RESOURCE_LOADED = "resource-loaded";
	const PAGE_ENDED = "page-ended";
	const STAGE_STARTED = "stage-started";
	const STAGE_ENDED = "stage-ended";
	const STAGE_TASK_STARTED = "stage-task-started";
	const STAGE_TASK_ENDED = "stage-task-ended";

	class ProgressEvent {
		constructor(type, detail) {
			return { type, detail, PAGE_LOADING, PAGE_LOADED, RESOURCES_INITIALIZING, RESOURCES_INITIALIZED, RESOURCE_LOADED, PAGE_ENDED, STAGE_STARTED, STAGE_ENDED, STAGE_TASK_STARTED, STAGE_TASK_ENDED };
		}
	}

	// ------
	// Runner
	// ------
	const RESOLVE_URLS_STAGE = 0;
	const REPLACE_DATA_STAGE = 1;
	const REPLACE_DOCS_STAGE = 2;
	const POST_PROCESS_STAGE = 3;
	const STAGES = [{
		sequential: [
			{ action: "preProcessPage" },
			{ action: "insertShadowRootContents" },
			{ action: "replaceStyleContents" },
			{ option: "selected", action: "removeUnselectedElements" },
			{ option: "removeVideoSrc", action: "insertVideoPosters" },
			{ option: "removeFrames", action: "removeFrames" },
			{ option: "removeImports", action: "removeImports" },
			{ option: "removeScripts", action: "removeScripts" },
			{ option: "removeVideoSrc", action: "removeVideoSources" },
			{ option: "removeAudioSrc", action: "removeAudioSources" },
			{ action: "removeDiscardedResources" },
			{ action: "resetCharsetMeta" },
			{ action: "setInputValues" },
			{ option: "insertFaviconLink", action: "insertFaviconLink" },
			{ action: "replaceCanvasElements" },
			{ action: "insertFonts" },
			{ option: "removeHiddenElements", action: "removeHiddenElements" },
			{ action: "resolveHrefs" },
			{ action: "resolveStyleAttributeURLs" }
		],
		parallel: [
			{ action: "resolveStylesheetURLs" },
			{ option: "!removeFrames", action: "resolveFrameURLs" },
			{ option: "!removeImports", action: "resolveHtmlImportURLs" }
		]
	}, {
		sequential: [
			{ option: "removeUnusedStyles", action: "removeUnusedStyles" },
			{ option: "removeAlternativeMedias", action: "removeAlternativeMedias" },
			{ option: "removeUnusedFonts", action: "removeUnusedFonts" }
		],
		parallel: [
			{ action: "processStylesheets" },
			{ action: "processStyleAttributes" },
			{ action: "processPageResources" },
			{ option: "!removeScripts", action: "processScripts" }
		]
	}, {
		sequential: [
			{ option: "removeAlternativeImages", action: "removeAlternativeImages" },
			{ option: "removeAlternativeFonts", action: "removeAlternativeFonts" }
		],
		parallel: [
			{ option: "!removeFrames", action: "processFrames" },
			{ option: "!removeImports", action: "processHtmlImports" },
		]
	}, {
		sequential: [
			{ action: "replaceStylesheets" },
			{ action: "replaceStyleAttributes" },
			{ action: "insertVariables" },
			{ option: "compressHTML", action: "compressHTML" }
		]
	}];

	class Runner {
		constructor(options, root) {
			this.root = root;
			this.options = options;
			this.options.url = this.options.url || this.options.doc.location.href;
			this.options.baseURI = this.options.doc && this.options.doc.baseURI;
			this.batchRequest = new BatchRequest();
			this.processor = new Processor(options, this.batchRequest);
			if (this.options.doc) {
				const docData = DocUtil.preProcessDoc(this.options.doc, this.options.win, this.options);
				this.options.canvasData = docData.canvasData;
				this.options.fontsData = docData.fontsData;
				this.options.stylesheetContents = docData.stylesheetContents;
				this.options.imageData = docData.imageData;
				this.options.postersData = docData.postersData;
				this.options.usedFonts = docData.usedFonts;
				this.options.shadowRootContents = docData.shadowRootContents;
			}
			if (this.options.saveRawPage) {
				this.options.removeFrames = true;
			}
			this.options.content = this.options.content || (this.options.doc ? DocUtil.serialize(this.options.doc, false) : null);
			this.onprogress = options.onprogress || (() => { });
		}

		async loadPage() {
			this.onprogress(new ProgressEvent(PAGE_LOADING, { pageURL: this.options.url, frame: !this.root }));
			await this.processor.loadPage(this.options.content);
			this.onprogress(new ProgressEvent(PAGE_LOADED, { pageURL: this.options.url, frame: !this.root }));
		}

		async initialize() {
			this.onprogress(new ProgressEvent(RESOURCES_INITIALIZING, { pageURL: this.options.url }));
			await this.executeStage(RESOLVE_URLS_STAGE);
			this.pendingPromises = this.executeStage(REPLACE_DATA_STAGE);
			if (this.options.doc) {
				DocUtil.postProcessDoc(this.options.doc, this.options);
				this.options.doc = null;
				this.options.win = null;
			}
		}

		async run() {
			if (this.root) {
				this.processor.initialize(this.batchRequest);
				this.onprogress(new ProgressEvent(RESOURCES_INITIALIZED, { pageURL: this.options.url, index: 0, max: this.processor.maxResources }));
			}
			await this.batchRequest.run(detail => {
				detail.pageURL = this.options.url;
				this.onprogress(new ProgressEvent(RESOURCE_LOADED, detail));
			}, this.options);
			await this.pendingPromises;
			await this.executeStage(REPLACE_DOCS_STAGE);
			await this.executeStage(POST_PROCESS_STAGE);
			await this.processor.finalize();
		}

		async getPageData() {
			if (this.root) {
				this.onprogress(new ProgressEvent(PAGE_ENDED, { pageURL: this.options.url }));
			}
			return this.processor.getPageData();
		}

		async executeStage(step) {
			if (DEBUG) {
				log("**** STARTED STAGE", step, "****");
			}
			const frame = !this.root;
			this.onprogress(new ProgressEvent(STAGE_STARTED, { pageURL: this.options.url, step, frame }));
			STAGES[step].sequential.forEach(task => {
				let startTime;
				if (DEBUG) {
					startTime = Date.now();
					log("  -- STARTED task =", task.action);
				}
				this.onprogress(new ProgressEvent(STAGE_TASK_STARTED, { pageURL: this.options.url, step, task: task.action, frame }));
				this.executeTask(task);
				this.onprogress(new ProgressEvent(STAGE_TASK_ENDED, { pageURL: this.options.url, step, task: task.action, frame }));
				if (DEBUG) {
					log("  -- ENDED   task =", task.action, "delay =", Date.now() - startTime);
				}
			});
			let parallelTasksPromise;
			if (STAGES[step].parallel) {
				parallelTasksPromise = await Promise.all(STAGES[step].parallel.map(async task => {
					let startTime;
					if (DEBUG) {
						startTime = Date.now();
						log("  // STARTED task =", task.action);
					}
					this.onprogress(new ProgressEvent(STAGE_TASK_STARTED, { pageURL: this.options.url, step, task: task.action, frame }));
					await this.executeTask(task);
					this.onprogress(new ProgressEvent(STAGE_TASK_ENDED, { pageURL: this.options.url, step, task: task.action, frame }));
					if (DEBUG) {
						log("  // ENDED task =", task.action, "delay =", Date.now() - startTime);
					}
				}));
			} else {
				parallelTasksPromise = Promise.resolve();
			}
			this.onprogress(new ProgressEvent(STAGE_ENDED, { pageURL: this.options.url, step, frame }));
			if (DEBUG) {
				log("**** ENDED   STAGE", step, "****");
			}
			return parallelTasksPromise;
		}

		executeTask(task) {
			if (!task.option || ((task.option.startsWith("!") && !this.options[task.option]) || this.options[task.option])) {
				return this.processor[task.action]();
			}
		}
	}

	// ------------
	// BatchRequest
	// ------------
	class BatchRequest {
		constructor() {
			this.requests = new Map();
			this.duplicates = new Map();
		}

		async addURL(resourceURL, asDataURI, groupDuplicates) {
			return new Promise((resolve, reject) => {
				const requestKey = JSON.stringify([resourceURL, asDataURI]);
				let resourceRequests = this.requests.get(requestKey);
				if (!resourceRequests) {
					resourceRequests = [];
					this.requests.set(requestKey, resourceRequests);
				}
				const callbacks = { resolve, reject };
				resourceRequests.push(callbacks);
				if (groupDuplicates) {
					let duplicateRequests = this.duplicates.get(requestKey);
					if (!duplicateRequests) {
						duplicateRequests = [];
						this.duplicates.set(requestKey, duplicateRequests);
					}
					duplicateRequests.push(callbacks);
				}
			});
		}

		getMaxResources() {
			return Array.from(this.requests.keys()).length;
		}

		async run(onloadListener, options) {
			const resourceURLs = Array.from(this.requests.keys());
			let indexResource = 0;
			return Promise.all(resourceURLs.map(async requestKey => {
				const [resourceURL, asDataURI] = JSON.parse(requestKey);
				const resourceRequests = this.requests.get(requestKey);
				try {
					const content = await DocUtil.getContent(resourceURL, { asDataURI, maxResourceSize: options.maxResourceSize, maxResourceSizeEnabled: options.maxResourceSizeEnabled });
					indexResource = indexResource + 1;
					onloadListener({ index: indexResource, url: resourceURL });
					resourceRequests.forEach(callbacks => {
						const duplicateCallbacks = this.duplicates.get(requestKey);
						const duplicate = duplicateCallbacks && duplicateCallbacks.length > 1 && duplicateCallbacks.includes(callbacks);
						callbacks.resolve({ content: content.data, indexResource, duplicate });
					});
				} catch (error) {
					indexResource = indexResource + 1;
					onloadListener({ index: indexResource, url: resourceURL });
					resourceRequests.forEach(resourceRequest => resourceRequest.reject(error));
				}
				this.requests.delete(requestKey);
			}));
		}
	}

	// ---------
	// Processor
	// ---------
	const EMPTY_DATA_URI = "data:base64,";
	const EMPTY_IMAGE = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
	const SCRIPT_TAG_FOUND = /<script/gi;
	const NOSCRIPT_TAG_FOUND = /<noscript/gi;

	class Processor {
		constructor(options, batchRequest) {
			this.options = options;
			this.stats = new Stats(options);
			this.baseURI = Util.normalizeURL(options.baseURI || options.url);
			this.batchRequest = batchRequest;
			this.stylesheets = new Map();
			this.styles = new Map();
			this.cssVariables = new Map();
		}

		initialize() {
			this.maxResources = this.batchRequest.getMaxResources();
			if (!this.options.saveRawPage && !this.options.removeFrames) {
				this.options.framesData.forEach(frameData => this.maxResources += frameData.maxResources || 0);
			}
			this.stats.set("processed", "resources", this.maxResources);
		}

		async loadPage(pageContent, charset) {
			let content;
			if (!pageContent || this.options.saveRawPage) {
				content = await DocUtil.getContent(this.baseURI, { asDataURI: false, maxResourceSize: this.options.maxResourceSize, maxResourceSizeEnabled: this.options.maxResourceSizeEnabled, charset });
				pageContent = content.data;
			}
			this.doc = DocUtil.parseDocContent(pageContent, this.baseURI);
			if (this.options.saveRawPage) {
				let charset;
				this.doc.querySelectorAll("meta[charset], meta[http-equiv=\"content-type\"]").forEach(element => {
					const charsetDeclaration = element.content.split(";")[1];
					if (charsetDeclaration && !charset) {
						charset = charsetDeclaration.split("=")[1].trim().toLowerCase();
					}
				});
				if (charset && charset != content.charset) {
					return this.loadPage(pageContent, charset);
				}
			}
			this.onEventAttributeNames = Util.getOnEventAttributeNames(this.doc);
		}

		async finalize() {
			const metaCharset = this.doc.head.querySelector("meta[charset]");
			if (metaCharset) {
				this.doc.head.insertBefore(metaCharset, this.doc.head.firstChild);
			}
			this.doc.querySelectorAll("base").forEach(element => element.remove());
			if (this.doc.head.querySelectorAll("*").length == 1 && metaCharset && this.doc.body.childNodes.length == 0) {
				this.doc.head.querySelector("meta[charset]").remove();
			}
			const titleElement = this.doc.querySelector("title");
			const descriptionElement = this.doc.querySelector("meta[name=description]");
			const authorElement = this.doc.querySelector("meta[name=author]");
			const creatorElement = this.doc.querySelector("meta[name=creator]");
			const publisherElement = this.doc.querySelector("meta[name=publisher]");
			this.options.title = titleElement ? titleElement.textContent.trim() : "";
			this.options.infobarContent = await ProcessorHelper.evalTemplate(this.options.infobarTemplate, this.options, null, true);
			this.options.info = {
				description: descriptionElement && descriptionElement.content ? descriptionElement.content.trim() : "",
				lang: this.doc.documentElement.lang,
				author: authorElement && authorElement.content ? authorElement.content.trim() : "",
				creator: creatorElement && creatorElement.content ? creatorElement.content.trim() : "",
				publisher: publisherElement && publisherElement.content ? publisherElement.content.trim() : ""
			};
		}

		async getPageData() {
			DocUtil.postProcessDoc(this.doc, this.options);
			const url = DocUtil.parseURL(this.baseURI);
			if (this.options.insertSingleFileComment) {
				const infobarContent = (this.options.infobarContent || "").replace(/\\n/g, "\n").replace(/\\t/g, "\t");
				const commentNode = this.doc.createComment("\n Page saved with SingleFile" +
					" \n url: " + this.options.url +
					" \n saved date: " + new Date() +
					(infobarContent ? " \n info: " + infobarContent : "") + "\n");
				this.doc.documentElement.insertBefore(commentNode, this.doc.documentElement.firstChild);
			}
			let size;
			if (this.options.displayStats) {
				size = DocUtil.getContentSize(this.doc.documentElement.outerHTML);
			}
			const content = DocUtil.serialize(this.doc, this.options.compressHTML);
			if (this.options.displayStats) {
				const contentSize = DocUtil.getContentSize(content);
				this.stats.set("processed", "HTML bytes", contentSize);
				this.stats.add("discarded", "HTML bytes", size - contentSize);
			}
			let filename = await ProcessorHelper.evalTemplate(this.options.filenameTemplate, this.options, content);
			filename = filename.replace(/[~\\?%*:|"<>\x00-\x1f\x7F]+/g, "_"); // eslint-disable-line no-control-regex
			filename = filename.replace(/\.\.\//g, "").replace(/^\/+/, "").replace(/\/+/g, "/").replace(/\/$/, "");
			if (!this.options.backgroundSave) {
				filename = filename.replace(/\//g, "_");
			}
			if (filename.length > 192) {
				const extensionMatch = filename.match(/(\.[^.]{3,4})$/);
				const extension = extensionMatch && extensionMatch[0] && extensionMatch[0].length > 1 ? extensionMatch[0] : "";
				filename = filename.substring(0, 192 - extension.length) + "…" + extension;
			}
			if (!filename) {
				filename = "Unnamed page";
			}
			const matchTitle = this.baseURI.match(/([^/]*)\/?(\.html?.*)$/) || this.baseURI.match(/\/\/([^/]*)\/?$/);
			return {
				stats: this.stats.data,
				title: this.options.title || (this.baseURI && matchTitle ? matchTitle[1] : (url.hostname ? url.hostname : "")),
				filename,
				content
			};
		}

		preProcessPage() {
			if (this.options.win) {
				this.doc.body.querySelectorAll(":not(svg) title, meta, link[href][rel*=\"icon\"]").forEach(element => element instanceof this.options.win.HTMLElement && this.doc.head.appendChild(element));
			}
			if (this.options.imageData) {
				const dataAttributeName = DocUtil.imagesAttributeName(this.options.sessionId);
				this.doc.querySelectorAll("img").forEach(imgElement => {
					const imgData = this.options.imageData[Number(imgElement.getAttribute(dataAttributeName))];
					if (this.options.removeHiddenElements && imgData.size && !imgData.size.pxWidth && !imgData.size.pxHeight) {
						imgElement.setAttribute("src", EMPTY_IMAGE);
					} else if (imgData.currentSrc) {
						imgElement.setAttribute("src", imgData.currentSrc);
					}
				});
				if (!this.options.saveRawPage && this.options.loadDeferredImages) {
					this.doc.querySelectorAll("img[data-src]").forEach(imgElement => {
						const imgData = this.options.imageData[Number(imgElement.getAttribute(dataAttributeName))];
						if ((!imgElement.getAttribute("src") || imgElement.getAttribute("src") == EMPTY_IMAGE) && imgElement.getAttribute("data-src")) {
							imgData.src = imgElement.dataset.src;
							imgElement.setAttribute("src", imgElement.dataset.src);
							imgElement.removeAttribute("data-src");
						}
					});
					this.doc.querySelectorAll("img[data-srcset]").forEach(imgElement => {
						if (!imgElement.getAttribute("srcset") && imgElement.getAttribute("data-srcset")) {
							imgElement.setAttribute("srcset", imgElement.dataset.srcset);
							imgElement.removeAttribute("data-srcset");
						}
					});
				}
			}
		}

		insertShadowRootContents() {
			if (this.options.shadowRootContents) {
				this.doc.querySelectorAll("[" + DocUtil.shadowRootAttributeName(this.options.sessionId) + "]").forEach((element, elementIndex) => {
					const elementInfo = this.options.shadowRootContents[elementIndex];
					if (elementInfo) {
						const frameElement = this.doc.createElement("iframe");
						frameElement.setAttribute("style", "all:initial!important;border:0!important;width:100%!important;height:" + elementInfo.height + "px!important");
						const windowId = "shadow-" + this.options.framesData.length;
						frameElement.setAttribute(DocUtil.windowIdAttributeName(this.options.sessionId), windowId);
						this.options.framesData.push({ windowId, content: elementInfo.content, baseURI: this.baseURI });
						element.appendChild(frameElement);
					}
				});
			}
		}

		replaceStyleContents() {
			if (this.options.stylesheetContents) {
				this.doc.querySelectorAll("style").forEach((styleElement, styleIndex) => {
					if (this.options.stylesheetContents[styleIndex]) {
						styleElement.textContent = this.options.stylesheetContents[styleIndex];
					}
				});
			}
		}

		removeUnselectedElements() {
			const rootElement = this.doc.querySelector("[" + SELECTED_CONTENT_ROOT_ATTRIBUTE_NAME + "]");
			if (rootElement) {
				ProcessorHelper.isolateElements(rootElement);
				rootElement.removeAttribute(SELECTED_CONTENT_ROOT_ATTRIBUTE_NAME);
				rootElement.removeAttribute(SELECTED_CONTENT_ATTRIBUTE_NAME);
			}
		}

		insertVideoPosters() {
			if (this.options.postersData) {
				this.doc.querySelectorAll("video[src], video > source[src]").forEach((element, videoIndex) => {
					let videoElement;
					if (element.tagName == "VIDEO") {
						videoElement = element;
					} else {
						videoElement = element.parentElement;
					}
					if (!videoElement.poster && this.options.postersData[videoIndex]) {
						videoElement.setAttribute("poster", this.options.postersData[videoIndex]);
					}
				});
			}
		}

		removeFrames() {
			const frameElements = this.doc.querySelectorAll("iframe, frame, object[type=\"text/html\"][data]");
			this.stats.set("discarded", "frames", frameElements.length);
			this.stats.set("processed", "frames", frameElements.length);
			this.doc.querySelectorAll("iframe, frame, object[type=\"text/html\"][data]").forEach(element => element.remove());
		}

		removeImports() {
			const importElements = this.doc.querySelectorAll("link[rel=import]");
			this.stats.set("discarded", "HTML imports", importElements.length);
			this.stats.set("processed", "HTML imports", importElements.length);
			importElements.forEach(element => element.remove());
		}

		removeScripts() {
			this.onEventAttributeNames.forEach(attributeName => this.doc.querySelectorAll("[" + attributeName + "]").forEach(element => element.removeAttribute(attributeName)));
			this.doc.querySelectorAll("[href]").forEach(element => {
				if (element.href && element.href.match && element.href.match(/^\s*javascript:/)) {
					element.setAttribute("href", "");
				}
			});
			this.doc.querySelectorAll("[src]").forEach(element => {
				if (element.src && element.src.match(/^\s*javascript:/)) {
					element.removeAttribute("src");
				}
			});
			const scriptElements = this.doc.querySelectorAll("script:not([type=\"application/ld+json\"])");
			this.stats.set("discarded", "scripts", scriptElements.length);
			this.stats.set("processed", "scripts", scriptElements.length);
			scriptElements.forEach(element => element.remove());
		}

		removeVideoSources() {
			const videoSourceElements = this.doc.querySelectorAll("video[src], video > source");
			this.stats.set("discarded", "video sources", videoSourceElements.length);
			this.stats.set("processed", "video sources", videoSourceElements.length);
			videoSourceElements.forEach(element => {
				if (element.tagName == "SOURCE") {
					element.remove();
				} else {
					videoSourceElements.forEach(element => element.removeAttribute("src"));
				}
			});
		}

		removeAudioSources() {
			const audioSourceElements = this.doc.querySelectorAll("audio[src], audio > source[src]");
			this.stats.set("discarded", "audio sources", audioSourceElements.length);
			this.stats.set("processed", "audio sources", audioSourceElements.length);
			audioSourceElements.forEach(element => {
				if (element.tagName == "SOURCE") {
					element.remove();
				} else {
					audioSourceElements.forEach(element => element.removeAttribute("src"));
				}
			});
		}

		removeDiscardedResources() {
			this.doc.querySelectorAll("singlefile-infobar, singlefile-mask, singlefile-logs-window").forEach(element => element.remove());
			const objectElements = this.doc.querySelectorAll("applet, meta[http-equiv=refresh], object[data]:not([type=\"image/svg+xml\"]):not([type=\"image/svg-xml\"]):not([type=\"text/html\"]), embed[src]:not([src*=\".svg\"])");
			this.stats.set("discarded", "objects", objectElements.length);
			this.stats.set("processed", "objects", objectElements.length);
			objectElements.forEach(element => element.remove());
			const replacedAttributeValue = this.doc.querySelectorAll("link[rel~=preconnect], link[rel~=prerender], link[rel~=dns-prefetch], link[rel~=preload], link[rel~=prefetch]");
			replacedAttributeValue.forEach(element => {
				const relValue = element.getAttribute("rel").replace(/(preconnect|prerender|dns-prefetch|preload|prefetch)/g, "").trim();
				if (relValue.length) {
					element.setAttribute("rel", relValue);
				} else {
					element.remove();
				}
			});
			this.doc.querySelectorAll("link[rel*=stylesheet][rel*=alternate][title]").forEach(element => element.remove());
			this.doc.querySelectorAll("meta[http-equiv=\"content-security-policy\"]").forEach(element => element.remove());
			if (this.options.compressHTML) {
				this.doc.querySelectorAll("input[type=hidden]").forEach(element => element.remove());
			}
			this.doc.querySelectorAll("a[ping]").forEach(element => element.removeAttribute("ping"));
		}

		resetCharsetMeta() {
			let charset;
			this.doc.querySelectorAll("meta[charset], meta[http-equiv=\"content-type\"]").forEach(element => {
				const charsetDeclaration = element.content.split(";")[1];
				if (charsetDeclaration && !charset) {
					charset = charsetDeclaration.split("=")[1];
					if (charset) {
						this.charset = charset.trim().toLowerCase();
					}
				}
				element.remove();
			});
			const metaElement = this.doc.createElement("meta");
			metaElement.setAttribute("charset", "utf-8");
			if (this.doc.head.firstChild) {
				this.doc.head.insertBefore(metaElement, this.doc.head.firstChild);
			} else {
				this.doc.head.appendChild(metaElement);
			}
		}

		setInputValues() {
			this.doc.querySelectorAll("input").forEach(input => {
				const value = input.getAttribute(DocUtil.inputValueAttributeName(this.options.sessionId));
				input.setAttribute("value", value || "");
			});
			this.doc.querySelectorAll("input[type=radio], input[type=checkbox]").forEach(input => {
				const value = input.getAttribute(DocUtil.inputValueAttributeName(this.options.sessionId));
				if (value == "true") {
					input.setAttribute("checked", "");
				}
			});
			this.doc.querySelectorAll("textarea").forEach(textarea => {
				const value = textarea.getAttribute(DocUtil.inputValueAttributeName(this.options.sessionId));
				textarea.textContent = value || "";
			});
			this.doc.querySelectorAll("select").forEach(select => {
				select.querySelectorAll("option").forEach(option => {
					const selected = option.getAttribute(DocUtil.inputValueAttributeName(this.options.sessionId)) != null;
					if (selected) {
						option.setAttribute("selected", "");
					}
				});
			});
		}

		insertFaviconLink() {
			let faviconElement = this.doc.querySelector("link[href][rel=\"icon\"]");
			if (!faviconElement) {
				faviconElement = this.doc.querySelector("link[href][rel=\"shortcut icon\"]");
			}
			if (!faviconElement) {
				faviconElement = this.doc.createElement("link");
				faviconElement.setAttribute("type", "image/x-icon");
				faviconElement.setAttribute("rel", "shortcut icon");
				faviconElement.setAttribute("href", "/favicon.ico");
			}
			this.doc.head.appendChild(faviconElement);
		}

		replaceCanvasElements() {
			if (this.options.canvasData) {
				this.doc.querySelectorAll("canvas").forEach((canvasElement, indexCanvasElement) => {
					const canvasData = this.options.canvasData[indexCanvasElement];
					if (canvasData) {
						ProcessorHelper.setBackgroundImage(canvasElement, "url(" + canvasData.dataURI + ")");
						this.stats.add("processed", "canvas", 1);
					}
				});
			}
		}

		insertFonts() {
			if (this.options.fontsData && this.options.fontsData.length) {
				let stylesheetContent = "";
				this.options.fontsData.forEach(fontStyles => {
					if (fontStyles["font-family"] && fontStyles.src) {
						stylesheetContent += "@font-face{";
						let stylesContent = "";
						Object.keys(fontStyles).forEach(fontStyle => {
							if (stylesContent) {
								stylesContent += ";";
							}
							stylesContent += fontStyle + ":" + fontStyles[fontStyle];
						});
						stylesheetContent += stylesContent + "}";
					}
				});
				if (stylesheetContent) {
					const styleElement = this.doc.createElement("style");
					styleElement.textContent = stylesheetContent;
					const existingStyleElement = this.doc.querySelector("style");
					if (existingStyleElement) {
						existingStyleElement.parentElement.insertBefore(styleElement, existingStyleElement);
					} else {
						this.doc.head.insertBefore(styleElement, this.doc.head.firstChild);
					}
				}
			}
		}

		removeHiddenElements() {
			const hiddenElements = this.doc.querySelectorAll("[" + DocUtil.removedContentAttributeName(this.options.sessionId) + "]");
			this.stats.set("discarded", "hidden elements", hiddenElements.length);
			this.stats.set("processed", "hidden elements", hiddenElements.length);
			hiddenElements.forEach(element => element.remove());
		}

		resolveHrefs() {
			this.doc.querySelectorAll("a[href], area[href], link[href]").forEach(element => {
				const href = element.getAttribute("href").trim();
				if (!Util.testIgnoredPath(href) && !href.startsWith("#")) {
					try {
						element.setAttribute("href", DocUtil.resolveURL(href, this.options.baseURI || this.options.url));
					} catch (error) {
						// ignored
					}
				}
			});
		}

		resolveStyleAttributeURLs() {
			this.doc.querySelectorAll("[style]").forEach(element => {
				let styleContent = element.getAttribute("style");
				if (this.options.compressCSS) {
					styleContent = DocUtil.compressCSS(styleContent);
				}
				styleContent = ProcessorHelper.resolveStylesheetURLs(styleContent, this.baseURI, this.options);
				const declarationList = cssTree.parse(styleContent, { context: "declarationList" });
				this.styles.set(element, declarationList);
			});
		}

		async resolveStylesheetURLs() {
			await Promise.all(Array.from(this.doc.querySelectorAll("style, link[rel*=stylesheet]"))
				.map(async element => {
					let mediaText;
					if (element.media) {
						mediaText = element.media.toLowerCase();
					}
					this.stylesheets.set(element, { mediaText });
					const options = { maxResourceSize: this.options.maxResourceSize, maxResourceSizeEnabled: this.options.maxResourceSizeEnabled, url: this.options.url, charset: this.charset, compressCSS: this.options.compressCSS };
					let stylesheetContent;
					if (element.tagName.toLowerCase() == "link") {
						if (element.charset) {
							options.charset = element.charset;
						}
						stylesheetContent = await ProcessorHelper.resolveLinkStylesheetURLs(element.href, this.baseURI, options);
					} else {
						stylesheetContent = await ProcessorHelper.resolveImportURLs(element.textContent, this.baseURI, options);
					}
					let stylesheet;
					try {
						stylesheet = cssTree.parse(stylesheetContent);
					} catch (error) {
						// ignored
					}
					if (stylesheet && stylesheet.children) {
						if (this.options.compressCSS) {
							ProcessorHelper.removeSingleLineCssComments(stylesheet);
						}
						this.stylesheets.get(element).stylesheet = stylesheet;
					} else {
						this.stylesheets.delete(element);
					}
				}));
		}

		async resolveFrameURLs() {
			if (!this.options.saveRawPage && this.options.framesData) {
				const frameElements = Array.from(this.doc.querySelectorAll("iframe, frame, object[type=\"text/html\"][data]"));
				await Promise.all(frameElements.map(async frameElement => {
					ProcessorHelper.setFrameEmptySrc(frameElement);
					const frameWindowId = frameElement.getAttribute(DocUtil.windowIdAttributeName(this.options.sessionId));
					if (frameWindowId) {
						const frameData = this.options.framesData.find(frame => frame.windowId == frameWindowId);
						if (frameData) {
							await initializeProcessor(frameData, frameElement, frameWindowId, this.batchRequest, Object.create(this.options));
						}
					}
				}));
			}

			async function initializeProcessor(frameData, frameElement, frameWindowId, batchRequest, options) {
				options.insertSingleFileComment = false;
				options.insertFaviconLink = false;
				options.doc = null;
				options.win = null;
				options.url = frameData.baseURI;
				options.windowId = frameWindowId;
				if (frameData.content) {
					options.content = frameData.content;
					options.canvasData = frameData.canvasData;
					options.stylesheetContents = frameData.stylesheetContents;
					options.fontsData = frameData.fontsData;
					options.imageData = frameData.imageData;
					options.usedFonts = frameData.usedFonts;
					frameData.processor = new Runner(options);
					frameData.frameElement = frameElement;
					await frameData.processor.loadPage();
					await frameData.processor.initialize();
					frameData.maxResources = batchRequest.getMaxResources();
				}
			}
		}

		async resolveHtmlImportURLs() {
			const linkElements = Array.from(this.doc.querySelectorAll("link[rel=import][href]"));
			if (!this.relImportProcessors) {
				this.relImportProcessors = new Map();
			}
			await Promise.all(linkElements.map(async linkElement => {
				const resourceURL = linkElement.href;
				linkElement.removeAttribute("href");
				const options = Object.create(this.options);
				options.insertSingleFileComment = false;
				options.insertFaviconLink = false;
				options.doc = null;
				options.win = null;
				options.url = resourceURL;
				if (!Util.testIgnoredPath(resourceURL) && Util.testValidPath(resourceURL, this.baseURI, this.options.url)) {
					const processor = new Runner(options);
					this.relImportProcessors.set(linkElement, processor);
					await processor.loadPage();
					return processor.initialize();
				}
			}));
		}

		removeUnusedStyles() {
			if (!this.mediaAllInfo) {
				this.mediaAllInfo = DocUtil.getMediaAllInfo(this.doc, this.stylesheets, this.styles);
			}
			const stats = DocUtil.minifyCSSRules(this.stylesheets, this.styles, this.mediaAllInfo);
			this.stats.set("processed", "CSS rules", stats.processed);
			this.stats.set("discarded", "CSS rules", stats.discarded);
		}

		removeUnusedFonts() {
			DocUtil.removeUnusedFonts(this.doc, this.stylesheets, this.styles, this.options);
		}

		removeAlternativeMedias() {
			const stats = DocUtil.minifyMedias(this.stylesheets);
			this.stats.set("processed", "medias", stats.processed);
			this.stats.set("discarded", "medias", stats.discarded);
		}

		async processStylesheets() {
			await Promise.all(Array.from(this.stylesheets).map(([, stylesheetInfo]) =>
				ProcessorHelper.processStylesheet(stylesheetInfo.stylesheet.children, this.baseURI, this.options, this.cssVariables, this.batchRequest)
			));
		}

		async processStyleAttributes() {
			return Promise.all(Array.from(this.styles).map(([, declarationList]) =>
				ProcessorHelper.processStyle(declarationList.children.toArray(), this.baseURI, this.options, this.cssVariables, this.batchRequest)
			));
		}

		async processPageResources() {
			const processAttributeArgs = [
				["link[href][rel*=\"icon\"]", "href", "data:", false, true],
				["object[type=\"image/svg+xml\"], object[type=\"image/svg-xml\"]", "data", PREFIX_DATA_URI_IMAGE_SVG],
				["img[src], input[src][type=image]", "src", PREFIX_DATA_URI_IMAGE, true],
				["embed[src*=\".svg\"]", "src", PREFIX_DATA_URI_IMAGE_SVG],
				["video[poster]", "poster", PREFIX_DATA_URI_IMAGE],
				["*[background]", "background", PREFIX_DATA_URI_IMAGE],
				["image", "xlink:href", PREFIX_DATA_URI_IMAGE]
			];
			let resourcePromises = processAttributeArgs.map(([selector, attributeName, prefixDataURI, processDuplicates, removeElementIfMissing]) =>
				ProcessorHelper.processAttribute(this.doc.querySelectorAll(selector), attributeName, prefixDataURI, this.baseURI, this.options, this.cssVariables, this.styles, this.batchRequest, processDuplicates, removeElementIfMissing)
			);
			resourcePromises = resourcePromises.concat([
				ProcessorHelper.processXLinks(this.doc.querySelectorAll("use"), this.baseURI, this.options, this.batchRequest),
				ProcessorHelper.processSrcset(this.doc.querySelectorAll("img[srcset], source[srcset]"), "srcset", PREFIX_DATA_URI_IMAGE, this.baseURI, this.options, this.batchRequest)
			]);
			if (!this.options.removeAudioSrc) {
				resourcePromises.push(ProcessorHelper.processAttribute(this.doc.querySelectorAll("audio[src], audio > source[src]"), "src", PREFIX_DATA_URI_AUDIO, this.baseURI, this.options, this.cssVariables, this.styles, this.batchRequest));
			}
			if (!this.options.removeVideoSrc) {
				resourcePromises.push(ProcessorHelper.processAttribute(this.doc.querySelectorAll("video[src], video > source[src]"), "src", PREFIX_DATA_URI_VIDEO, this.baseURI, this.options, this.cssVariables, this.styles, this.batchRequest));
			}
			await Promise.all(resourcePromises);
			ProcessorHelper.processShortcutIcons(this.doc);
		}

		async processScripts() {
			await Promise.all(Array.from(this.doc.querySelectorAll("script[src]")).map(async scriptElement => {
				let resourceURL;
				const scriptSrc = scriptElement.getAttribute("src");
				scriptElement.removeAttribute("src");
				scriptElement.textContent = "";
				try {
					resourceURL = DocUtil.resolveURL(scriptSrc, this.baseURI);
				} catch (error) {
					// ignored
				}
				if (Util.testValidURL(resourceURL, this.baseURI, this.options.url)) {
					this.stats.add("processed", "scripts", 1);
					const content = await DocUtil.getContent(resourceURL, { asDataURI: true, maxResourceSize: this.options.maxResourceSize, maxResourceSizeEnabled: this.options.maxResourceSizeEnabled });
					scriptElement.setAttribute("src", content.data);
				}
			}));
		}

		removeAlternativeImages() {
			DocUtil.removeAlternativeImages(this.doc);
		}

		removeAlternativeFonts() {
			DocUtil.removeAlternativeFonts(this.doc, this.stylesheets);
		}

		async processFrames() {
			if (this.options.framesData) {
				const frameElements = Array.from(this.doc.querySelectorAll("iframe, frame, object[type=\"text/html\"][data]"));
				await Promise.all(frameElements.map(async frameElement => {
					const frameWindowId = frameElement.getAttribute(DocUtil.windowIdAttributeName(this.options.sessionId));
					if (frameWindowId) {
						const frameData = this.options.framesData.find(frame => frame.windowId == frameWindowId);
						if (frameData) {
							if (frameData.processor) {
								this.stats.add("processed", "frames", 1);
								await frameData.processor.run();
								const pageData = await frameData.processor.getPageData();
								frameElement.removeAttribute(DocUtil.windowIdAttributeName(this.options.sessionId));
								if (pageData.content.match(NOSCRIPT_TAG_FOUND) || pageData.content.match(SCRIPT_TAG_FOUND)) {
									frameElement.setAttribute("sandbox", "allow-scripts allow-same-origin");
								} else {
									frameElement.setAttribute("sandbox", "");
								}
								ProcessorHelper.setFrameContent(frameElement, pageData.content);
								this.stats.addAll(pageData);
							} else {
								this.stats.add("discarded", "frames", 1);
							}
						}
					}
				}));
			}
		}

		async processHtmlImports() {
			const linkElements = Array.from(this.doc.querySelectorAll("link[rel=import][href]"));
			await Promise.all(linkElements.map(async linkElement => {
				const processor = this.relImportProcessors.get(linkElement);
				if (processor) {
					this.stats.add("processed", "HTML imports", 1);
					this.relImportProcessors.delete(linkElement);
					const pageData = await processor.getPageData();
					linkElement.setAttribute("href", "data:text/html," + pageData.content);
					this.stats.addAll(pageData);
				} else {
					this.stats.add("discarded", "HTML imports", 1);
				}
			}));
		}

		replaceStylesheets() {
			this.doc.querySelectorAll("style").forEach(styleElement => {
				const stylesheetInfo = this.stylesheets.get(styleElement);
				if (stylesheetInfo) {
					let stylesheetContent = cssTree.generate(stylesheetInfo.stylesheet);
					styleElement.textContent = stylesheetContent;
					if (stylesheetInfo.mediaText) {
						styleElement.media = stylesheetInfo.mediaText;
					}
				} else {
					styleElement.remove();
				}
			});
			this.doc.querySelectorAll("link[rel*=stylesheet]").forEach(linkElement => {
				const stylesheetInfo = this.stylesheets.get(linkElement);
				if (stylesheetInfo) {
					const styleElement = this.doc.createElement("style");
					if (stylesheetInfo.mediaText) {
						styleElement.media = stylesheetInfo.mediaText;
					}
					let stylesheetContent = cssTree.generate(stylesheetInfo.stylesheet);
					styleElement.textContent = stylesheetContent;
					linkElement.parentElement.replaceChild(styleElement, linkElement);
				} else {
					linkElement.remove();
				}
			});
		}

		replaceStyleAttributes() {
			this.doc.querySelectorAll("[style]").forEach(async element => {
				const declarations = this.styles.get(element);
				if (declarations) {
					let styleContent = cssTree.generate(declarations);
					element.setAttribute("style", styleContent);
				} else {
					element.setAttribute("style", "");
				}
			});
		}

		insertVariables() {
			if (this.cssVariables.size) {
				const styleElement = this.doc.createElement("style");
				const firstStyleElement = this.doc.head.querySelector("style");
				if (firstStyleElement) {
					this.doc.head.insertBefore(styleElement, firstStyleElement);
				} else {
					this.doc.head.appendChild(styleElement);
				}
				let stylesheetContent = "";
				this.cssVariables.forEach((content, indexResource) => {
					if (stylesheetContent) {
						stylesheetContent += ";";
					}
					stylesheetContent += `${SINGLE_FILE_VARIABLE_NAME_PREFIX + indexResource}:url("${content}")`;
				});
				styleElement.textContent = ":root{" + stylesheetContent + "}";
			}
		}

		compressHTML() {
			let size;
			if (this.options.displayStats) {
				size = DocUtil.getContentSize(this.doc.documentElement.outerHTML);
			}
			DocUtil.minifyHTML(this.doc, { preservedSpaceAttributeName: DocUtil.preservedSpaceAttributeName(this.options.sessionId) });
			if (this.options.displayStats) {
				this.stats.add("discarded", "HTML bytes", size - DocUtil.getContentSize(this.doc.documentElement.outerHTML));
			}
		}
	}

	// ---------------
	// ProcessorHelper
	// ---------------
	const REGEXP_AMP = /&/g;
	const REGEXP_NBSP = /\u00a0/g;
	const REGEXP_START_TAG = /</g;
	const REGEXP_END_TAG = />/g;
	const REGEXP_URL_HASH = /(#.+?)$/;
	const PREFIX_DATA_URI_IMAGE = "data:image/";
	const PREFIX_DATA_URI_AUDIO = "data:audio/";
	const PREFIX_DATA_URI_VIDEO = "data:video/";
	const PREFIX_DATA_URI_IMAGE_SVG = "data:image/svg+xml";
	const PREFIX_DATA_URI_NO_MIMETYPE = "data:;";
	const PREFIX_DATA_URI_OCTET_STREAM = /^data:(application|binary)\/octet-stream/;
	const PREFIX_DATA_URI_NULL_STREAM = /^data:null;/;
	const PREFIX_DATA_URI_VND = "data:application/vnd.";
	const SINGLE_FILE_VARIABLE_NAME_PREFIX = "--sf-img-";

	class ProcessorHelper {
		static async evalTemplate(template, options, content, dontReplaceSlash) {
			const date = new Date();
			const url = DocUtil.parseURL(options.url);
			template = await Util.evalTemplateVariable(template, "page-title", () => options.title || "No title", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "page-language", () => options.info.lang || "No language", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "page-description", () => options.info.description || "No description", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "page-author", () => options.info.author || "No author", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "page-creator", () => options.info.creator || "No creator", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "page-publisher", () => options.info.publisher || "No publisher", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "datetime-iso", () => date.toISOString(), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "date-iso", () => date.toISOString().split("T")[0], dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "time-iso", () => date.toISOString().split("T")[1].split("Z")[0], dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "date-locale", () => date.toLocaleDateString(), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "time-locale", () => date.toLocaleTimeString(), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "day-locale", () => String(date.getDate()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "month-locale", () => String(date.getMonth() + 1).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "year-locale", () => String(date.getFullYear()), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "datetime-locale", () => date.toLocaleString(), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "datetime-utc", () => date.toUTCString(), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "day-utc", () => String(date.getUTCDate()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "month-utc", () => String(date.getUTCMonth() + 1).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "year-utc", () => String(date.getUTCFullYear()), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "hours-locale", () => String(date.getHours()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "minutes-locale", () => String(date.getMinutes()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "seconds-locale", () => String(date.getSeconds()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "hours-utc", () => String(date.getUTCHours()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "minutes-utc", () => String(date.getUTCMinutes()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "seconds-utc", () => String(date.getUTCSeconds()).padStart(2, "0"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-hash", () => url.hash.substring(1) || "No hash", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-host", () => url.host.replace(/\/$/, "") || "No host", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-hostname", () => url.hostname.replace(/\/$/, "") || "No hostname", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-href", () => url.href || "No href", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-password", () => url.password || "No password", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-pathname", () => url.pathname.replace(/^\//, "").replace(/\/$/, "") || "No pathname", dontReplaceSlash === undefined ? true : dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-port", () => url.port || "No port", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-protocol", () => url.protocol || "No protocol", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-search", () => url.search.substring(1) || "No search", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-username", () => url.username || "No username", dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "tab-id", () => String(options.tabId || "No tab id"), dontReplaceSlash);
			template = await Util.evalTemplateVariable(template, "url-last-segment", () => Util.getLastSegment(url) || "No last segment", dontReplaceSlash);
			if (content) {
				template = await Util.evalTemplateVariable(template, "digest-sha-256", async () => DocUtil.digest("SHA-256", content), dontReplaceSlash);
				template = await Util.evalTemplateVariable(template, "digest-sha-384", async () => DocUtil.digest("SHA-384", content), dontReplaceSlash);
				template = await Util.evalTemplateVariable(template, "digest-sha-512", async () => DocUtil.digest("SHA-512", content), dontReplaceSlash);
			}
			return template;
		}

		static setBackgroundImage(element, url, style) {
			element.style.setProperty("background-blend-mode", "normal", "important");
			element.style.setProperty("background-clip", "border-box", "important");
			element.style.setProperty("background-position", style && style["background-position"] ? style["background-position"] : "center", "important");
			element.style.setProperty("background-color", style && style["background-color"] ? style["background-color"] : "transparent", "important");
			element.style.setProperty("background-image", url, "important");
			element.style.setProperty("background-size", style && style["background-size"] ? style["background-size"] : "100% 100%", "important");
			element.style.setProperty("background-origin", "content-box", "important");
			element.style.setProperty("background-repeat", "no-repeat", "important");
		}

		static processShortcutIcons(doc) {
			let shortcutIcon = Util.findShortcutIcon(Array.from(doc.querySelectorAll("link[href][rel=\"icon\"], link[href][rel=\"shortcut icon\"]")));
			if (!shortcutIcon) {
				shortcutIcon = Util.findShortcutIcon(Array.from(doc.querySelectorAll("link[href][rel*=\"icon\"]")));
				if (shortcutIcon) {
					shortcutIcon.rel = "icon";
				}
			}
			if (shortcutIcon) {
				doc.querySelectorAll("link[href][rel*=\"icon\"]").forEach(linkElement => {
					if (linkElement != shortcutIcon) {
						linkElement.remove();
					}
				});
			}
		}

		static setFrameEmptySrc(frameElement) {
			if (frameElement.tagName == "OBJECT") {
				frameElement.setAttribute("data", "data:text/html,");
			} else {
				frameElement.removeAttribute("src");
				frameElement.removeAttribute("srcdoc");
			}
		}

		static setFrameContent(frameElement, content) {
			if (frameElement.tagName == "OBJECT") {
				frameElement.setAttribute("data", "data:text/html," + content);
			} else {
				if (frameElement.tagName == "FRAME") {
					frameElement.setAttribute("src", "data:text/html," + content.replace(/#/g, "%23"));
				} else {
					frameElement.setAttribute("srcdoc", content);
					frameElement.removeAttribute("src");
				}
			}
		}

		static isolateElements(rootElement) {
			rootElement.querySelectorAll("*:not(style)").forEach(element => {
				if (element.getAttribute(SELECTED_CONTENT_ATTRIBUTE_NAME) == "") {
					element.removeAttribute(SELECTED_CONTENT_ATTRIBUTE_NAME);
				} else if (!element.querySelector("[" + SELECTED_CONTENT_ATTRIBUTE_NAME + "]")) {
					element.remove();
				}
			});
			isolateParentElements(rootElement.parentElement, rootElement);

			function isolateParentElements(parentElement, element) {
				let elementFound = false;
				Array.from(parentElement.childNodes).forEach(node => {
					elementFound = elementFound || (node == element);
					const tagName = node.tagName && node.tagName.toLowerCase();
					if (node != element && tagName != "svg" && tagName != "style" && tagName != "link") {
						if (elementFound) {
							node.remove();
						} else {
							node.hidden = true;
							if (node.childNodes && node.childNodes.length) {
								Array.from(node.childNodes).forEach(node => node.remove());
							}
						}
					}
				});
				element = element.parentElement;
				if (element && element.parentElement && element.parentElement.tagName != "HTML") {
					isolateParentElements(element.parentElement, element);
				}
			}
		}

		static removeSingleLineCssComments(stylesheet) {
			const removedRules = [];
			for (let cssRule = stylesheet.children.head; cssRule; cssRule = cssRule.next) {
				const ruleData = cssRule.data;
				if (ruleData.type == "Raw" && ruleData.value && ruleData.value.trim().startsWith("//")) {
					removedRules.push(cssRule);
				}
			}
			removedRules.forEach(cssRule => stylesheet.children.remove(cssRule));
		}

		static async resolveImportURLs(stylesheetContent, baseURI, options) {
			stylesheetContent = ProcessorHelper.resolveStylesheetURLs(stylesheetContent, baseURI, options);
			const imports = Util.getImportFunctions(stylesheetContent);
			await Promise.all(imports.map(async cssImport => {
				const match = Util.matchImport(cssImport);
				if (match) {
					let resourceURL = Util.normalizeURL(match.resourceURL);
					if (!Util.testIgnoredPath(resourceURL) && Util.testValidPath(resourceURL, baseURI, options.url)) {
						try {
							resourceURL = DocUtil.resolveURL(match.resourceURL, baseURI);
						} catch (error) {
							// ignored
						}
						if (Util.testValidURL(resourceURL, baseURI, options.url)) {
							const downloadOptions = { asDataURI: false, maxResourceSize: options.maxResourceSize, maxResourceSizeEnabled: options.maxResourceSizeEnabled, validateTextContentType: true };
							const content = await DocUtil.getContent(resourceURL, downloadOptions);
							resourceURL = content.resourceURL;
							let importedStylesheetContent = Util.removeCssComments(content.data);
							if (options.compressCSS) {
								importedStylesheetContent = DocUtil.compressCSS(importedStylesheetContent);
							}
							importedStylesheetContent = Util.wrapMediaQuery(importedStylesheetContent, match.media);
							if (stylesheetContent.includes(cssImport)) {
								importedStylesheetContent = await ProcessorHelper.resolveImportURLs(importedStylesheetContent, resourceURL, options);
								stylesheetContent = stylesheetContent.replace(Util.getRegExp(cssImport), importedStylesheetContent);
							}
						}
					}
				}
			}));
			return stylesheetContent;
		}

		static resolveStylesheetURLs(stylesheetContent, baseURI, options) {
			const urlFunctions = Util.getUrlFunctions(stylesheetContent);
			urlFunctions.map(urlFunction => {
				const originalResourceURL = Util.matchURL(urlFunction);
				const resourceURL = Util.normalizeURL(originalResourceURL);
				if (!Util.testIgnoredPath(resourceURL)) {
					if (!resourceURL || Util.testValidPath(resourceURL, baseURI, options.url)) {
						let resolvedURL;
						try {
							resolvedURL = DocUtil.resolveURL(resourceURL, baseURI);
						} catch (error) {
							// ignored
						}
						if (Util.testValidURL(resolvedURL, baseURI, options.url) && resourceURL != resolvedURL && stylesheetContent.includes(urlFunction)) {
							stylesheetContent = stylesheetContent.replace(Util.getRegExp(urlFunction), urlFunction.replace(originalResourceURL, resolvedURL));
						}
					} else {
						let newUrlFunction;
						if (originalResourceURL) {
							newUrlFunction = urlFunction.replace(originalResourceURL, EMPTY_DATA_URI);
						} else {
							newUrlFunction = "url(" + EMPTY_DATA_URI + ")";
						}
						stylesheetContent = stylesheetContent.replace(Util.getRegExp(urlFunction), newUrlFunction);
					}
				} else {
					if (resourceURL.startsWith(DATA_URI_PREFIX)) {
						const escapedResourceURL = resourceURL.replace(REGEXP_AMP, "&amp;").replace(REGEXP_NBSP, "&nbsp;").replace(REGEXP_START_TAG, "&lt;").replace(REGEXP_END_TAG, "&gt;");
						if (escapedResourceURL != resourceURL && stylesheetContent.includes(urlFunction)) {
							stylesheetContent = stylesheetContent.replace(Util.getRegExp(urlFunction), urlFunction.replace(originalResourceURL, escapedResourceURL));
						}
					}
				}
			});
			return stylesheetContent;
		}

		static async resolveLinkStylesheetURLs(resourceURL, baseURI, options) {
			resourceURL = Util.normalizeURL(resourceURL);
			if (resourceURL && resourceURL != baseURI && resourceURL != ABOUT_BLANK_URI) {
				const downloadOptions = { asDataURI: false, maxResourceSize: options.maxResourceSize, maxResourceSizeEnabled: options.maxResourceSizeEnabled, charset: options.charset };
				const content = await DocUtil.getContent(resourceURL, downloadOptions);
				resourceURL = content.resourceURL;
				let stylesheetContent = Util.removeCssComments(content.data);
				if (options.compressCSS) {
					stylesheetContent = DocUtil.compressCSS(stylesheetContent);
				}
				stylesheetContent = await ProcessorHelper.resolveImportURLs(stylesheetContent, resourceURL, options);
				return stylesheetContent;
			}
		}

		static async processStylesheet(cssRules, baseURI, options, cssVariables, batchRequest) {
			const promises = [];
			const removedRules = [];
			for (let cssRule = cssRules.head; cssRule; cssRule = cssRule.next) {
				const ruleData = cssRule.data;
				if (ruleData.type == "Atrule" && ruleData.name == "charset") {
					removedRules.push(cssRule);
				} else if (ruleData.block && ruleData.block.children) {
					if (ruleData.type == "Rule") {
						promises.push(this.processStyle(ruleData.block.children.toArray(), baseURI, options, cssVariables, batchRequest));
					} else if (ruleData.type == "Atrule" && (ruleData.name == "media" || ruleData.name == "supports")) {
						promises.push(this.processStylesheet(ruleData.block.children, baseURI, options, cssVariables, batchRequest));
					} else if (ruleData.type == "Atrule" && ruleData.name == "font-face") {
						promises.push(processFontFaceRule(ruleData));
					}
				}
			}
			removedRules.forEach(cssRule => cssRules.remove(cssRule));
			await Promise.all(promises);

			async function processFontFaceRule(ruleData) {
				await Promise.all(ruleData.block.children.toArray().map(async declaration => {
					if (declaration.type == "Declaration" && declaration.value.children) {
						const urlFunctions = Util.getUrlFunctions(Util.getCSSValue(declaration.value));
						await Promise.all(urlFunctions.map(async urlFunction => {
							const originalResourceURL = Util.matchURL(urlFunction);
							const resourceURL = Util.normalizeURL(originalResourceURL);
							if (!Util.testIgnoredPath(resourceURL)) {
								if (Util.testValidURL(resourceURL, baseURI, options.url)) {
									let { content } = await batchRequest.addURL(resourceURL, true);
									if (content != EMPTY_DATA_URI && !content.startsWith(PREFIX_DATA_URI_VND) && !content.startsWith(PREFIX_DATA_URI_IMAGE_SVG)) {
										const validResource = await DocUtil.validFont(urlFunction);
										if (!validResource) {
											content = EMPTY_DATA_URI;
										}
									}
									replaceURLs(declaration, originalResourceURL, content);
								}
							} else if (resourceURL.startsWith(DATA_URI_PREFIX) && !resourceURL.startsWith(PREFIX_DATA_URI_VND) && !resourceURL.startsWith(PREFIX_DATA_URI_IMAGE_SVG)) {
								const validResource = await DocUtil.validFont(urlFunction);
								if (!validResource) {
									replaceURLs(declaration, originalResourceURL, EMPTY_DATA_URI);
								}
							}
						}));
					}
				}));

				function replaceURLs(declaration, oldURL, newURL) {
					declaration.value.children.forEach(token => {
						if (token.type == "Url" && DocUtil.removeQuotes(Util.getCSSValue(token.value)) == oldURL) {
							token.value.value = newURL;
						}
					});
				}
			}
		}

		static async processStyle(declarations, baseURI, options, cssVariables, batchRequest) {
			await Promise.all(declarations.map(async declaration => {
				if (declaration.type == "Declaration" && declaration.value.children) {
					const urlFunctions = Util.getUrlFunctions(Util.getCSSValue(declaration.value));
					await Promise.all(urlFunctions.map(async urlFunction => {
						const originalResourceURL = Util.matchURL(urlFunction);
						const resourceURL = Util.normalizeURL(originalResourceURL);
						if (!Util.testIgnoredPath(resourceURL)) {
							if (Util.testValidURL(resourceURL, baseURI, options.url)) {
								let { content, indexResource, duplicate } = await batchRequest.addURL(resourceURL, true, true);
								let variableDefined;
								const tokens = [];
								findURLToken(originalResourceURL, declaration.value.children, (token, parent, rootFunction) => {
									if (duplicate && options.groupDuplicateImages && rootFunction) {
										const value = cssTree.parse("var(" + SINGLE_FILE_VARIABLE_NAME_PREFIX + indexResource + ")", { context: "value" }).children.head;
										tokens.push({ parent, token, value });
										variableDefined = true;
									} else {
										token.data.value.value = content;
									}
								});
								if (variableDefined) {
									cssVariables.set(indexResource, content);
									tokens.forEach(({ parent, token, value }) => parent.replace(token, value));
								}
							}
						}
					}));
				}
			}));

			function findURLToken(url, children, callback, depth = 0) {
				for (let token = children.head; token; token = token.next) {
					if (token.data.children) {
						findURLToken(url, token.data.children, callback, depth + 1);
					}
					if (token.data.type == "Url" && DocUtil.removeQuotes(Util.getCSSValue(token.data.value)) == url) {
						callback(token, children, depth == 0);
					}
				}
			}
		}

		static async processAttribute(resourceElements, attributeName, prefixDataURI, baseURI, options, cssVariables, styles, batchRequest, processDuplicates, removeElementIfMissing) {
			await Promise.all(Array.from(resourceElements).map(async resourceElement => {
				let resourceURL = resourceElement.getAttribute(attributeName);
				resourceURL = Util.normalizeURL(resourceURL);
				if (!Util.testIgnoredPath(resourceURL)) {
					resourceElement.setAttribute(attributeName, EMPTY_IMAGE);
					if (Util.testValidPath(resourceURL, baseURI, options.url)) {
						try {
							resourceURL = DocUtil.resolveURL(resourceURL, baseURI);
						} catch (error) {
							// ignored
						}
						if (Util.testValidURL(resourceURL, baseURI, options.url)) {
							const { content, indexResource, duplicate } = await batchRequest.addURL(resourceURL, true, resourceElement.tagName == "IMG" && attributeName == "src");
							if (removeElementIfMissing && content == EMPTY_DATA_URI) {
								resourceElement.remove();
							} else {
								if (content.startsWith(prefixDataURI) || content.startsWith(PREFIX_DATA_URI_NO_MIMETYPE) || content.match(PREFIX_DATA_URI_OCTET_STREAM) || content.match(PREFIX_DATA_URI_NULL_STREAM)) {
									const isSVG = content.startsWith(PREFIX_DATA_URI_IMAGE_SVG);
									if (processDuplicates && duplicate && options.groupDuplicateImages && !isSVG) {
										if (Util.replaceImageSource(resourceElement, SINGLE_FILE_VARIABLE_NAME_PREFIX + indexResource, options)) {
											cssVariables.set(indexResource, content);
											const declarationList = cssTree.parse(resourceElement.getAttribute("style"), { context: "declarationList" });
											styles.set(resourceElement, declarationList);
										} else {
											resourceElement.setAttribute(attributeName, content);
										}
									} else {
										resourceElement.setAttribute(attributeName, content);
									}
								}
							}
						}
					}
				}
			}));
		}

		static async processXLinks(resourceElements, baseURI, options, batchRequest) {
			const attributeName = "xlink:href";
			await Promise.all(Array.from(resourceElements).map(async resourceElement => {
				const originalResourceURL = resourceElement.getAttribute(attributeName);
				let resourceURL = Util.normalizeURL(originalResourceURL);
				if (Util.testValidPath(resourceURL, baseURI, options.url) && !Util.testIgnoredPath(resourceURL)) {
					resourceElement.setAttribute(attributeName, EMPTY_IMAGE);
					try {
						resourceURL = DocUtil.resolveURL(resourceURL, baseURI);
					} catch (error) {
						// ignored
					}
					if (Util.testValidURL(resourceURL, baseURI, options.url)) {
						try {
							const { content } = await batchRequest.addURL(resourceURL);
							const hashMatch = originalResourceURL.match(REGEXP_URL_HASH);
							if (hashMatch && hashMatch[0]) {
								const svgDoc = DocUtil.parseSVGContent(content);
								const symbolElement = svgDoc.querySelector(hashMatch[0]);
								if (symbolElement) {
									resourceElement.setAttribute(attributeName, hashMatch[0]);
									resourceElement.parentElement.insertBefore(symbolElement, resourceElement.parentElement.firstChild);
								}
							} else {
								resourceElement.setAttribute(attributeName, PREFIX_DATA_URI_IMAGE_SVG + "," + content);
							}
						} catch (error) {
							/* ignored */
						}
					}
				} else if (resourceURL == options.url) {
					resourceElement.setAttribute(attributeName, originalResourceURL.substring(resourceURL.length));
				}
			}));
		}

		static async processSrcset(resourceElements, attributeName, prefixDataURI, baseURI, options, batchRequest) {
			await Promise.all(Array.from(resourceElements).map(async resourceElement => {
				const srcset = DocUtil.parseSrcset(resourceElement.getAttribute(attributeName));
				const srcsetValues = await Promise.all(srcset.map(async srcsetValue => {
					let resourceURL = Util.normalizeURL(srcsetValue.url);
					if (!Util.testIgnoredPath(resourceURL)) {
						if (Util.testValidPath(resourceURL, baseURI, options.url)) {
							try {
								resourceURL = DocUtil.resolveURL(resourceURL, baseURI);
							} catch (error) {
								// ignored
							}
							if (Util.testValidURL(resourceURL, baseURI, options.url)) {
								const { content } = await batchRequest.addURL(resourceURL, true);
								if (!content.startsWith(prefixDataURI) && !content.startsWith(PREFIX_DATA_URI_NO_MIMETYPE) && !content.match(PREFIX_DATA_URI_OCTET_STREAM) && !content.match(PREFIX_DATA_URI_NULL_STREAM)) {
									resourceElement.setAttribute(attributeName, EMPTY_IMAGE);
								}
								return content + (srcsetValue.w ? " " + srcsetValue.w + "w" : srcsetValue.d ? " " + srcsetValue.d + "x" : "");
							} else {
								return "";
							}
						} else {
							return "";
						}
					} else {
						return resourceURL + (srcsetValue.w ? " " + srcsetValue.w + "w" : srcsetValue.d ? " " + srcsetValue.d + "x" : "");
					}
				}));
				resourceElement.setAttribute(attributeName, srcsetValues.join(", "));
			}));
		}

	}

	// ----
	// Util
	// ----
	const DATA_URI_PREFIX = "data:";
	const BLOB_URI_PREFIX = "blob:";
	const HTTP_URI_PREFIX = /^https?:\/\//;
	const FILE_URI_PREFIX = /^file:\/\//;
	const EMPTY_URL = /^https?:\/\/+\s*$/;
	const ABOUT_BLANK_URI = "about:blank";
	const NOT_EMPTY_URL = /^(https?:\/\/|file:\/\/|blob:).+/;
	const REGEXP_URL_FN = /(url\s*\(\s*'(.*?)'\s*\))|(url\s*\(\s*"(.*?)"\s*\))|(url\s*\(\s*(.*?)\s*\))/gi;
	const REGEXP_URL_SIMPLE_QUOTES_FN = /^url\s*\(\s*'(.*?)'\s*\)$/i;
	const REGEXP_URL_DOUBLE_QUOTES_FN = /^url\s*\(\s*"(.*?)"\s*\)$/i;
	const REGEXP_URL_NO_QUOTES_FN = /^url\s*\(\s*(.*?)\s*\)$/i;
	const REGEXP_IMPORT_FN = /(@import\s*url\s*\(\s*'(.*?)'\s*\)\s*(.*?)(;|$|}))|(@import\s*url\s*\(\s*"(.*?)"\s*\)\s*(.*?)(;|$|}))|(@import\s*url\s*\(\s*(.*?)\s*\)\s*(.*?)(;|$|}))|(@import\s*'(.*?)'\s*(.*?)(;|$|}))|(@import\s*"(.*?)"\s*(.*?)(;|$|}))|(@import\s*(.*?)\s*(.*?)(;|$|}))/gi;
	const REGEXP_IMPORT_URL_SIMPLE_QUOTES_FN = /@import\s*url\s*\(\s*'(.*?)'\s*\)\s*(.*?)(;|$|})/i;
	const REGEXP_IMPORT_URL_DOUBLE_QUOTES_FN = /@import\s*url\s*\(\s*"(.*?)"\s*\)\s*(.*?)(;|$|})/i;
	const REGEXP_IMPORT_URL_NO_QUOTES_FN = /@import\s*url\s*\(\s*(.*?)\s*\)\s*(.*?)(;|$|})/i;
	const REGEXP_IMPORT_SIMPLE_QUOTES_FN = /@import\s*'(.*?)'\s*(.*?)(;|$|})/i;
	const REGEXP_IMPORT_DOUBLE_QUOTES_FN = /@import\s*"(.*?)"\s*(.*?)(;|$|})/i;
	const REGEXP_IMPORT_NO_QUOTES_FN = /@import\s*(.*?)\s*(.*?)(;|$|})/i;
	const REGEXP_ESCAPE = /([{}()^$&.*?/+|[\\\\]|\]|-)/g;

	class Util {
		static normalizeURL(url) {
			if (!url || url.startsWith(DATA_URI_PREFIX)) {
				return url;
			} else {
				return url.split("#")[0];
			}
		}

		static getCSSValue(value) {
			let result = "";
			try {
				result = cssTree.generate(value);
			} catch (error) {
				// ignored
			}
			return result;
		}

		static getOnEventAttributeNames(doc) {
			const element = doc.createElement("div");
			const attributeNames = [];
			for (const propertyName in element) {
				if (propertyName.startsWith("on")) {
					attributeNames.push(propertyName);
				}
			}
			return attributeNames;
		}

		static async evalTemplateVariable(template, variableName, valueGetter, dontReplaceSlash) {
			const replaceRegExp = new RegExp("{\\s*" + variableName + "\\s*}", "g");
			if (template.match(replaceRegExp)) {
				let value = await valueGetter();
				if (!dontReplaceSlash) {
					value = value.replace(/\/+/g, "_");
				}
				return template.replace(replaceRegExp, value);
			}
			return template;
		}

		static getLastSegment(url) {
			let lastSegmentMatch = url.pathname.match(/\/([^/]+)$/), lastSegment = lastSegmentMatch && lastSegmentMatch[0];
			if (!lastSegment) {
				lastSegmentMatch = url.href.match(/([^/]+)\/?$/);
				lastSegment = lastSegmentMatch && lastSegmentMatch[0];
			}
			if (!lastSegment) {
				lastSegmentMatch = lastSegment.match(/(.*)<\.[^.]+$/);
				lastSegment = lastSegmentMatch && lastSegmentMatch[0];
			}
			if (!lastSegment) {
				lastSegment = url.hostname.replace(/\/+/g, "_").replace(/\/$/, "");
			}
			lastSegment.replace(/\/$/, "").replace(/^\//, "");
			return lastSegment;
		}

		static getRegExp(string) {
			return new RegExp(string.replace(REGEXP_ESCAPE, "\\$1"), "gi");
		}

		static getUrlFunctions(stylesheetContent) {
			return Array.from(new Set(stylesheetContent.match(REGEXP_URL_FN) || []));
		}

		static getImportFunctions(stylesheetContent) {
			return stylesheetContent.match(REGEXP_IMPORT_FN) || [];
		}

		static findShortcutIcon(shortcutIcons) {
			shortcutIcons = shortcutIcons.filter(linkElement => linkElement.href != EMPTY_IMAGE);
			shortcutIcons.sort((linkElement1, linkElement2) => (parseInt(linkElement2.sizes, 10) || 16) - (parseInt(linkElement1.sizes, 10) || 16));
			return shortcutIcons[0];
		}

		static matchURL(stylesheetContent) {
			const match = stylesheetContent.match(REGEXP_URL_SIMPLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_URL_DOUBLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_URL_NO_QUOTES_FN);
			return match && match[1];
		}

		static testIgnoredPath(resourceURL) {
			return resourceURL && (resourceURL.startsWith(DATA_URI_PREFIX) || resourceURL == ABOUT_BLANK_URI);
		}

		static testValidPath(resourceURL, baseURI, docURL) {
			return resourceURL && resourceURL != baseURI && resourceURL != docURL && !resourceURL.match(EMPTY_URL);
		}

		static testValidURL(resourceURL, baseURI, docURL) {
			return Util.testValidPath(resourceURL, baseURI, docURL) && (resourceURL.match(HTTP_URI_PREFIX) || resourceURL.match(FILE_URI_PREFIX) || resourceURL.startsWith(BLOB_URI_PREFIX)) && resourceURL.match(NOT_EMPTY_URL);
		}

		static matchImport(stylesheetContent) {
			const match = stylesheetContent.match(REGEXP_IMPORT_URL_SIMPLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_IMPORT_URL_DOUBLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_IMPORT_URL_NO_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_IMPORT_SIMPLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_IMPORT_DOUBLE_QUOTES_FN) ||
				stylesheetContent.match(REGEXP_IMPORT_NO_QUOTES_FN);
			if (match) {
				const [, resourceURL, media] = match;
				return { resourceURL, media };
			}
		}

		static removeCssComments(stylesheetContent) {
			let start, end;
			do {
				start = stylesheetContent.indexOf("/*");
				end = stylesheetContent.indexOf("*/", start + 2);
				if (start != -1 && end != -1) {
					stylesheetContent = stylesheetContent.substring(0, start) + stylesheetContent.substr(end + 2);
				}
			} while (start != -1 && end != -1);
			return stylesheetContent;
		}

		static wrapMediaQuery(stylesheetContent, mediaQuery) {
			if (mediaQuery) {
				return "@media " + mediaQuery + "{ " + stylesheetContent + " }";
			} else {
				return stylesheetContent;
			}
		}

		static replaceImageSource(imgElement, variableName, options) {
			const dataAttributeName = DocUtil.imagesAttributeName(options.sessionId);
			if (imgElement.getAttribute(dataAttributeName) != null) {
				const imgData = options.imageData[Number(imgElement.getAttribute(dataAttributeName))];
				if (imgData.replaceable) {
					imgElement.setAttribute("src", `${PREFIX_DATA_URI_IMAGE_SVG},<svg xmlns="http://www.w3.org/2000/svg" width="${imgData.size.pxWidth}" height="${imgData.size.pxHeight}"><rect fill-opacity="0"/></svg>`);
					const backgroundStyle = {};
					const backgroundSize = (imgData.objectFit == "content" || imgData.objectFit == "cover") && imgData.objectFit;
					if (backgroundSize) {
						backgroundStyle["background-size"] = imgData.objectFit;
					}
					if (imgData.objectPosition) {
						backgroundStyle["background-position"] = imgData.objectPosition;
					}
					if (imgData.backgroundColor) {
						backgroundStyle["background-color"] = imgData.backgroundColor;
					}
					ProcessorHelper.setBackgroundImage(imgElement, "var(" + variableName + ")", backgroundStyle);
					imgElement.removeAttribute(dataAttributeName);
					return true;
				}
			}
		}

	}

	function log(...args) {
		console.log("S-File <core>   ", ...args); // eslint-disable-line no-console
	}

	// -----
	// Stats
	// -----
	const STATS_DEFAULT_VALUES = {
		discarded: {
			"HTML bytes": 0,
			"hidden elements": 0,
			"HTML imports": 0,
			scripts: 0,
			objects: 0,
			"audio sources": 0,
			"video sources": 0,
			frames: 0,
			"CSS rules": 0,
			canvas: 0,
			stylesheets: 0,
			resources: 0,
			medias: 0
		},
		processed: {
			"HTML bytes": 0,
			"hidden elements": 0,
			"HTML imports": 0,
			scripts: 0,
			objects: 0,
			"audio sources": 0,
			"video sources": 0,
			frames: 0,
			"CSS rules": 0,
			canvas: 0,
			stylesheets: 0,
			resources: 0,
			medias: 0
		}
	};

	class Stats {
		constructor(options) {
			this.options = options;
			if (options.displayStats) {
				this.data = JSON.parse(JSON.stringify(STATS_DEFAULT_VALUES));
			}
		}
		set(type, subType, value) {
			if (this.options.displayStats) {
				this.data[type][subType] = value;
			}
		}
		add(type, subType, value) {
			if (this.options.displayStats) {
				this.data[type][subType] += value;
			}
		}
		addAll(pageData) {
			if (this.options.displayStats) {
				Object.keys(this.data.discarded).forEach(key => this.add("discarded", key, pageData.stats.discarded[key] || 0));
				Object.keys(this.data.processed).forEach(key => this.add("processed", key, pageData.stats.processed[key] || 0));
			}
		}
	}

	return { getClass };

})();