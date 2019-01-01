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

/* global browser, singlefile, URL, Blob, FileReader */

singlefile.config = (() => {

	const DEFAULT_PROFILE_NAME = "__Default_Settings__";
	const DISABLED_PROFILE_NAME = "__Disabled_Settings__";
	const REGEXP_RULE_PREFIX = "regexp:";

	const DEFAULT_CONFIG = {
		removeHiddenElements: true,
		removeUnusedStyles: true,
		removeUnusedFonts: true,
		removeFrames: false,
		removeImports: true,
		removeScripts: true,
		compressHTML: true,
		compressCSS: true,
		loadDeferredImages: true,
		loadDeferredImagesMaxIdleTime: 1500,
		filenameTemplate: "{page-title} ({date-iso} {time-locale}).html",
		infobarTemplate: "",
		confirmInfobarContent: false,
		confirmFilename: false,
		filenameConflictAction: "uniquify",
		contextMenuEnabled: true,
		shadowEnabled: true,
		maxResourceSizeEnabled: false,
		maxResourceSize: 10,
		removeAudioSrc: true,
		removeVideoSrc: true,
		displayInfobar: true,
		displayStats: false,
		backgroundSave: true,
		autoSaveDelay: 1,
		autoSaveLoad: false,
		autoSaveUnload: false,
		autoSaveLoadOrUnload: true,
		removeAlternativeFonts: true,
		removeAlternativeMedias: true,
		removeAlternativeImages: true,
		groupDuplicateImages: true,
		saveRawPage: false
	};

	let pendingUpgradePromise = upgrade();
	browser.runtime.onMessage.addListener(request => {
		if (request.getOptions) {
			return getUrlOptions(request.url);
		}
	});

	async function upgrade() {
		const config = await browser.storage.local.get();
		if (!config.profiles) {
			const defaultConfig = config;
			delete defaultConfig.tabsData;
			applyUpgrade(defaultConfig);
			const newConfig = { profiles: {}, rules: [] };
			newConfig.profiles[DEFAULT_PROFILE_NAME] = defaultConfig;
			browser.storage.local.remove(Object.keys(DEFAULT_CONFIG));
			await browser.storage.local.set(newConfig);
		} else {
			if (!config.rules) {
				config.rules = [];
			}
			Object.keys(config.profiles).forEach(profileName => applyUpgrade(config.profiles[profileName]));
			await browser.storage.local.remove(["profiles", "defaultProfile", "rules"]);
			await browser.storage.local.set({ profiles: config.profiles, rules: config.rules });
		}
	}

	function applyUpgrade(config) {
		if (config.autoSaveLoadOrUnload === undefined && !config.autoSaveUnload && !config.autoSaveLoad) {
			config.autoSaveLoadOrUnload = true;
			config.autoSaveLoad = false;
			config.autoSaveUnload = false;
		}
		if (!config.maxResourceSize) {
			config.maxResourceSize = DEFAULT_CONFIG.maxResourceSize;
		}
		if (config.appendSaveDate !== undefined) {
			delete config.appendSaveDate;
		}
		if ((config.compressHTML === undefined || config.compressCSS === undefined) && config.compress !== undefined) {
			config.compressHTML = config.compressCSS = config.compress;
			delete config.compress;
		}
		upgradeOldConfig(config, "removeUnusedFonts", "removeUnusedStyles");
		upgradeOldConfig(config, "removeUnusedStyles", "removeUnusedCSSRules");
		upgradeOldConfig(config, "removeAlternativeImages", "removeSrcSet");
		upgradeOldConfig(config, "confirmInfobarContent", "confirmInfobar");
		upgradeOldConfig(config, "filenameConflictAction", "conflictAction");
		upgradeOldConfig(config, "loadDeferredImages", "lazyLoadImages");
		upgradeOldConfig(config, "loadDeferredImagesMaxIdleTime", "maxLazyLoadImagesIdleTime");
		Object.keys(DEFAULT_CONFIG).forEach(configKey => upgradeConfig(config, configKey));
	}

	function upgradeOldConfig(config, newKey, oldKey) {
		if (config[newKey] === undefined && config[oldKey] !== undefined) {
			config[newKey] = config[oldKey];
			delete config[oldKey];
		}
	}

	function upgradeConfig(config, key) {
		if (config[key] === undefined) {
			config[key] = DEFAULT_CONFIG[key];
		}
	}

	async function getUrlOptions(url) {
		const [config, tabsData] = await Promise.all([getConfig(), singlefile.tabsData.get()]);
		const rule = await getRule(url);
		return rule ? config.profiles[rule["profile"]] : config.profiles[tabsData.profileName || singlefile.config.DEFAULT_PROFILE_NAME];
	}

	async function getRule(url) {
		const config = await getConfig();
		const regExpRules = config.rules.filter(rule => testRegExpRule(rule));
		let rule = regExpRules.sort(sortRules).find(rule => url && url.match(new RegExp(rule.url.split(REGEXP_RULE_PREFIX)[1])));
		if (!rule) {
			const normalRules = config.rules.filter(rule => !testRegExpRule(rule));
			rule = normalRules.sort(sortRules).find(rule => url && url.includes(rule.url));
		}
		return rule;
	}

	async function getConfig() {
		await pendingUpgradePromise;
		return browser.storage.local.get(["profiles", "rules"]);
	}

	function sortRules(ruleLeft, ruleRight) {
		ruleRight.url.length - ruleLeft.url.length;
	}

	function testRegExpRule(rule) {
		return rule.url.toLowerCase().startsWith(REGEXP_RULE_PREFIX);
	}

	return {
		DISABLED_PROFILE_NAME,
		DEFAULT_PROFILE_NAME,
		async createProfile(profileName) {
			const config = await getConfig();
			if (Object.keys(config.profiles).includes(profileName)) {
				throw new Error("Duplicate profile name");
			}
			config.profiles[profileName] = DEFAULT_CONFIG;
			await browser.storage.local.set({ profiles: config.profiles });
		},
		async getProfiles() {
			const config = await getConfig();
			return config.profiles;
		},
		async getRule(url) {
			return getRule(url);
		},
		async getOptions(profileName, url, autoSave) {
			const [config, rule] = await Promise.all([getConfig(), getRule(url)]);
			return rule ? config.profiles[rule[autoSave ? "autoSaveProfile" : "profile"]] : config.profiles[profileName || singlefile.config.DEFAULT_PROFILE_NAME];
		},
		async updateProfile(profileName, profile) {
			const config = await getConfig();
			if (!Object.keys(config.profiles).includes(profileName)) {
				throw new Error("Profile not found");
			}
			config.profiles[profileName] = profile;
			await browser.storage.local.set({ profiles: config.profiles });
		},
		async renameProfile(oldProfileName, profileName) {
			const [config, tabsData] = await Promise.all([getConfig(), singlefile.tabsData.get()]);
			if (!Object.keys(config.profiles).includes(oldProfileName)) {
				throw new Error("Profile not found");
			}
			if (Object.keys(config.profiles).includes(profileName)) {
				throw new Error("Duplicate profile name");
			}
			if (oldProfileName == DEFAULT_PROFILE_NAME) {
				throw new Error("Default settings cannot be renamed");
			}
			if (tabsData.profileName == oldProfileName) {
				tabsData.profileName = profileName;
				await singlefile.tabsData.set(tabsData);
			}
			config.profiles[profileName] = config.profiles[oldProfileName];
			config.rules.forEach(rule => {
				if (rule.profile == oldProfileName) {
					rule.profile = profileName;
				}
				if (rule.autoSaveProfile == oldProfileName) {
					rule.autoSaveProfile = profileName;
				}
			});
			delete config.profiles[oldProfileName];
			await browser.storage.local.set({ profiles: config.profiles, rules: config.rules });
		},
		async deleteProfile(profileName) {
			const [config, tabsData] = await Promise.all([getConfig(), singlefile.tabsData.get()]);
			if (!Object.keys(config.profiles).includes(profileName)) {
				throw new Error("Profile not found");
			}
			if (profileName == DEFAULT_PROFILE_NAME) {
				throw new Error("Default settings cannot be deleted");
			}
			if (tabsData.profileName == profileName) {
				delete tabsData.profileName;
				await singlefile.tabsData.set(tabsData);
			}
			config.rules.forEach(rule => {
				if (rule.profile == profileName) {
					rule.profile = DEFAULT_PROFILE_NAME;
				}
				if (rule.autoSaveProfile == profileName) {
					rule.autoSaveProfile = DEFAULT_PROFILE_NAME;
				}
			});
			delete config.profiles[profileName];
			await browser.storage.local.set({ profiles: config.profiles, rules: config.rules });
		},
		async getRules() {
			const config = await getConfig();
			return config.rules;
		},
		async addRule(url, profile, autoSaveProfile) {
			if (!url) {
				throw new Error("URL is empty");
			}
			const config = await getConfig();
			if (config.rules.find(rule => rule.url == url)) {
				throw new Error("URL already exists");
			}
			config.rules.push({
				url,
				profile,
				autoSaveProfile
			});
			await browser.storage.local.set({ rules: config.rules });
		},
		async deleteRule(url) {
			if (!url) {
				throw new Error("URL is empty");
			}
			const config = await getConfig();
			config.rules = config.rules.filter(rule => rule.url != url);
			await browser.storage.local.set({ rules: config.rules });
		},
		async deleteRules(profileName) {
			const config = await getConfig();
			config.rules = config.rules = profileName ? config.rules.filter(rule => rule.autoSaveProfile != profileName && rule.profile != profileName) : [];
			await browser.storage.local.set({ rules: config.rules });
		},
		async updateRule(url, newURL, profile, autoSaveProfile) {
			if (!url || !newURL) {
				throw new Error("URL is empty");
			}
			const config = await getConfig();
			const urlConfig = config.rules.find(rule => rule.url == url);
			if (!urlConfig) {
				throw new Error("URL not found");
			}
			if (config.rules.find(rule => rule.url == newURL && rule.url != url)) {
				throw new Error("New URL already exists");
			}
			urlConfig.url = newURL;
			urlConfig.profile = profile;
			urlConfig.autoSaveProfile = autoSaveProfile;
			await browser.storage.local.set({ rules: config.rules });
		},
		async reset() {
			await pendingUpgradePromise;
			const tabsData = await singlefile.tabsData.get();
			delete tabsData.profileName;
			await singlefile.tabsData.set(tabsData);
			await browser.storage.local.remove(["profiles", "rules"]);
			await browser.storage.local.set({ profiles: { [DEFAULT_PROFILE_NAME]: DEFAULT_CONFIG }, rules: [] });
		},
		async export() {
			const config = await getConfig();
			const url = URL.createObjectURL(new Blob([JSON.stringify({ profiles: config.profiles, rules: config.rules }, null, 2)], { type: "text/json" }));
			const downloadInfo = {
				url,
				filename: "singlefile-settings.json",
				saveAs: true
			};
			const downloadId = await browser.downloads.download(downloadInfo);
			return new Promise((resolve, reject) => {
				browser.downloads.onChanged.addListener(onChanged);

				function onChanged(event) {
					if (event.id == downloadId && event.state) {
						if (event.state.current == "complete") {
							URL.revokeObjectURL(url);
							resolve({});
							browser.downloads.onChanged.removeListener(onChanged);
						}
						if (event.state.current == "interrupted" && (!event.error || event.error.current != "USER_CANCELED")) {
							URL.revokeObjectURL(url);
							reject(new Error(event.state.current));
							browser.downloads.onChanged.removeListener(onChanged);
						}
					}
				}
			});
		},
		async import(file) {
			const reader = new FileReader();
			reader.readAsText(file);
			const serializedConfig = await new Promise((resolve, reject) => {
				reader.addEventListener("load", () => resolve(reader.result), false);
				reader.addEventListener("error", reject, false);
			});
			const config = JSON.parse(serializedConfig);
			await browser.storage.local.remove(["profiles", "rules"]);
			await browser.storage.local.set({ profiles: config.profiles, rules: config.rules });
			await upgrade();
		}
	};

})();
