/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as es from 'event-stream';
import * as path from 'path';
import * as glob from 'glob';
import rename = require('gulp-rename');
import ext = require('./extensions');
import i18n = require('./i18n');
import * as fs from 'fs';
import * as File from 'vinyl';
import * as rimraf from 'rimraf';
import * as gulp from 'gulp';
import * as vfs from 'vinyl-fs';

/**
 * If you need to compile this file for any changes, please run: yarn tsc -p ./build/tsconfig.json
 */

const root = path.dirname(path.dirname(__dirname));

// Modified packageLocalExtensionsStream from extensions.ts, but for langpacks.
export function packageLangpacksStream(): NodeJS.ReadWriteStream {
	const langpackDescriptions = (<string[]>glob.sync('i18n/*/package.json'))
		.map(manifestPath => {
			const langpackPath = path.dirname(path.join(root, manifestPath));
			const langpackName = path.basename(langpackPath);
			return { name: langpackName, path: langpackPath };
		});

	const builtLangpacks = langpackDescriptions.map(langpack => {
		return ext.fromLocalNormal(langpack.path)
			.pipe(rename(p => p.dirname = `langpacks/${langpack.name}/${p.dirname}`));
	});

	return es.merge(builtLangpacks);
}

// Modified packageLocalExtensionsStream but for any ADS extensions including excluded/external ones.
export function packageSingleExtensionStream(name: string): NodeJS.ReadWriteStream {
	const extenalExtensionDescriptions = (<string[]>glob.sync(`extensions/${name}/package.json`))
		.map(manifestPath => {
			const extensionPath = path.dirname(path.join(root, manifestPath));
			const extensionName = path.basename(extensionPath);
			return { name: extensionName, path: extensionPath };
		});

	const builtExtension = extenalExtensionDescriptions.map(extension => {
		return ext.fromLocal(extension.path, false, true)
			.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
	});

	return es.merge(builtExtension);
}

// Langpack creation functions go here.

/**
 * Function combines the contents of the SQL core XLF file into the current main i18n file contianing the vs core strings.
 * Based on createI18nFile in i18n.ts
*/
function updateMainI18nFile(existingTranslationFilePath: string, originalFilePath: string, messages: any): File {
	let currFilePath = path.join(existingTranslationFilePath + '.i18n.json');
	let currentContent = fs.readFileSync(currFilePath);
	let currentContentObject = JSON.parse(currentContent.toString());
	let objectContents = currentContentObject.contents;
	let result = Object.create(null);

	// Delete any SQL strings that are no longer part of ADS in current langpack.
	for (let contentKey of Object.keys(objectContents)) {
		if (contentKey.startsWith('sql') && messages.contents[contentKey] === undefined) {
			delete objectContents[`${contentKey}`];
		}
	}

	messages.contents = { ...objectContents, ...messages.contents };
	result[''] = [
		'--------------------------------------------------------------------------------------------',
		'Copyright (c) Microsoft Corporation. All rights reserved.',
		'Licensed under the MIT License. See License.txt in the project root for license information.',
		'--------------------------------------------------------------------------------------------',
		'Do not edit this file. It is machine generated.'
	];
	for (let key of Object.keys(messages)) {
		result[key] = messages[key];
	}
	let content = JSON.stringify(result, null, '\t');

	if (process.platform === 'win32') {
		content = content.replace(/\n/g, '\r\n');
	}
	return new File({
		path: path.join(originalFilePath + '.i18n.json'),

		contents: Buffer.from(content, 'utf8'),
	});
}

/**
 * Function handles the processing of xlf resources and turning them into i18n.json files.
 * It adds the i18n files translation paths to be added back into package.main.
 * Based on prepareI18nPackFiles in i18n.ts
*/
export function modifyI18nPackFiles(existingTranslationFolder: string, resultingTranslationPaths: i18n.TranslationPath[], pseudo = false): NodeJS.ReadWriteStream {
	let parsePromises: Promise<i18n.ParsedXLF[]>[] = [];
	let mainPack: i18n.I18nPack = { version: i18n.i18nPackVersion, contents: {} };
	let extensionsPacks: i18n.StringMap<i18n.I18nPack> = {};
	let errors: any[] = [];
	return es.through(function (this: es.ThroughStream, xlf: File) {
		let rawResource = path.basename(xlf.relative, '.xlf');
		let resource = rawResource.substring(0, rawResource.lastIndexOf('.'));
		let contents = xlf.contents.toString();
		let parsePromise = pseudo ? i18n.XLF.parsePseudo(contents) : i18n.XLF.org_parse(contents);
		parsePromises.push(parsePromise);
		parsePromise.then(
			resolvedFiles => {
				resolvedFiles.forEach(file => {
					const path = file.originalFilePath;
					const firstSlash = path.indexOf('/');

					//exclude core sql file from extension processing.
					if (resource !== 'sql') {
						let extPack = extensionsPacks[resource];
						if (!extPack) {
							extPack = extensionsPacks[resource] = { version: i18n.i18nPackVersion, contents: {} };
						}
						//remove extensions/extensionId section as all extensions will be webpacked.
						const secondSlash = path.indexOf('/', firstSlash + 1);
						extPack.contents[path.substr(secondSlash + 1)] = file.messages;
					} else {
						mainPack.contents[path.substr(firstSlash + 1)] = file.messages;
					}
				});
			}
		).catch(reason => {
			errors.push(reason);
		});
	}, function () {
		Promise.all(parsePromises)
			.then(() => {
				if (errors.length > 0) {
					throw errors;
				}
				const translatedMainFile = updateMainI18nFile(existingTranslationFolder + '\\main', './main', mainPack);

				this.queue(translatedMainFile);
				for (let extension in extensionsPacks) {
					const translatedExtFile = i18n.createI18nFile(`extensions/${extension}`, extensionsPacks[extension]);
					this.queue(translatedExtFile);
					resultingTranslationPaths.push({ id: extension, resourceName: `extensions/${extension}.i18n.json` });
				}
				this.queue(null);
			})
			.catch((reason) => {
				this.emit('error', reason);
			});
	});
}

const textFields = {
	"nameText": 'ads',
	"displayNameText": 'Azure Data Studio',
	"publisherText": 'Microsoft',
	"licenseText": 'SEE MIT License IN LICENSE.txt',
	"updateText": 'cd ../vscode && npm run update-localization-extension ',
	"vscodeVersion": '*',
	"azdataVersion": '^1.47.0', // Update this to whatever the current version of the product is.
	"gitUrl": 'https://github.com/Microsoft/azuredatastudio'
};

//list of extensions from vscode that are to be included with ADS.
const VSCODEExtensions = [
	"bat",
	"builtin-notebook-renderers", // notebook renderers
	"configuration-editing",
	"docker",
	"git-base",
	"github",
	"github-authentication",
	"ipynb",
	"javascript",
	"json",
	"json-language-features",
	"markdown", // markdown-basics
	"markdown-language-features",
	"markdown-math",
	"media-preview",
	"merge-conflict",
	"microsoft-authentication",
	"powershell",
	"python",
	"r",
	"search-result",
	"simple-browser",
	"sql",
	"theme-abyss",
	"theme-defaults",
	"theme-kimbie-dark",
	"theme-monokai",
	"theme-monokai-dimmed",
	"theme-quietlight",
	"theme-red",
	"vscode-theme-seti", // theme-seti
	"theme-solarized-dark",
	"theme-solarized-light",
	"theme-tomorrow-night-blue",
	"xml",
	"yaml"
];

/**
 * A heavily modified version of update-localization-extension that runs using local xlf resources, no arguments required to pass in.
 * It converts a renamed vscode langpack to an ADS one or updates the existing langpack to use current XLF resources.
 * It runs this process on all langpacks currently in the ADS i18n folder.
 * (Replace an individual ADS langpack folder with a corresponding vscode langpack folder renamed to "ads" instead of "vscode"
 * in order to update vscode core strings and extensions for that langpack)
 *
 * It removes the resources of vscode that we do not support, and adds in new i18n json files created from the xlf files in the folder.
 * It also merges in the sql core XLF strings with the langpack's existing core strings into a combined main i18n json file.
 *
 * After running this gulp task, for each language pack:
 *
 * 1. Remember to change the version of the langpacks to continue from the previous version of the ADS langpack.
 *
 * 2. Also change the azdata version to match the current ADS version number.
 *
 * 3. Update the changelog with the new version of the language pack.
 *
 * IMPORTANT: If you have run this gulp task on langpacks that originated from vscode, for each affected vscode langpack, you must
 * replace the changelog and readme files with the ones from the previous ADS version of the langpack before doing the above steps.
 *
 * This is mainly for consistency with previous langpacks and to provide proper information to the user.
*/
export function refreshLangpacks(): Promise<void> {
	let supportedLocations = [...i18n.defaultLanguages, ...i18n.extraLanguages];

	for (let i = 0; i < supportedLocations.length; i++) {
		let langId = supportedLocations[i].id;
		if (langId === "zh-cn") {
			langId = "zh-hans";
		}
		if (langId === "zh-tw") {
			langId = "zh-hant";
		}

		let location = path.join('.', 'resources', 'xlf');
		let locExtFolder = path.join('.', 'i18n', `ads-language-pack-${langId}`);
		try {
			fs.statSync(locExtFolder);
		}
		catch {
			console.log('Language is not included in ADS yet: ' + langId);
			continue;
		}
		let packageJSON = JSON.parse(fs.readFileSync(path.join(locExtFolder, 'package.json')).toString());
		//processing extension fields, version and folder name must be changed manually.
		packageJSON['name'] = packageJSON['name'].replace('vscode', textFields.nameText).toLowerCase();
		packageJSON['displayName'] = packageJSON['displayName'].replace('Visual Studio Code', textFields.displayNameText);
		packageJSON['publisher'] = textFields.publisherText;
		packageJSON['license'] = textFields.licenseText;
		packageJSON['scripts']['update'] = textFields.updateText + langId;
		packageJSON['engines']['vscode'] = textFields.vscodeVersion;
		packageJSON['repository']['url'] = textFields.gitUrl;
		packageJSON['engines']['azdata'] = textFields.azdataVersion;

		let contributes = packageJSON['contributes'];
		if (!contributes) {
			throw new Error('The extension must define a "localizations" contribution in the "package.json"');
		}
		let localizations = contributes['localizations'];
		if (!localizations) {
			throw new Error('The extension must define a "localizations" contribution of type array in the "package.json"');
		}

		localizations.forEach(function (localization: any) {
			if (!localization.languageId || !localization.languageName || !localization.localizedLanguageName) {
				throw new Error('Each localization contribution must define "languageId", "languageName" and "localizedLanguageName" properties.');
			}
			let languageId = localization.transifexId || localization.languageId;
			let translationDataFolder = path.join(locExtFolder, 'translations');
			if (languageId === "zh-cn") {
				languageId = "zh-hans";
			}
			if (languageId === "zh-tw") {
				languageId = "zh-hant";
			}

			console.log(`Importing translations for ${languageId} from '${location}' to '${translationDataFolder}' ...`);
			let translationPaths: any = [];
			gulp.src(path.join(location, languageId, '**', '*.xlf'))
				.pipe(modifyI18nPackFiles(translationDataFolder, translationPaths, languageId === 'ps'))
				.on('error', (error: any) => {
					console.log(`Error occurred while importing translations:`);
					translationPaths = undefined;
					if (Array.isArray(error)) {
						error.forEach(console.log);
					} else if (error) {
						console.log(error);
					} else {
						console.log('Unknown error');
					}
				})
				.pipe(vfs.dest(translationDataFolder))
				.on('end', function () {
					if (translationPaths !== undefined) {
						let nonExistantExtensions = [];
						for (let curr of localization.translations) {
							try {
								fs.statSync(path.join(translationDataFolder, curr.path.replace('./translations', '')));
							}
							catch {
								nonExistantExtensions.push(curr);
							}
						}
						for (let nonExt of nonExistantExtensions) {
							let index = localization.translations.indexOf(nonExt);
							if (index > -1) {
								localization.translations.splice(index, 1);
							}
						}
						for (let tp of translationPaths) {
							let finalPath = `./translations/${tp.resourceName}`;
							let isFound = false;
							for (let i = 0; i < localization.translations.length; i++) {
								if (localization.translations[i].path === finalPath) {
									localization.translations[i].id = tp.id;
									isFound = true;
									break;
								}
							}
							if (!isFound) {
								localization.translations.push({ id: tp.id, path: finalPath });
							}
						}
						fs.writeFileSync(path.join(locExtFolder, 'package.json'), JSON.stringify(packageJSON, null, '\t'));
					}
				});

		});
	}
	console.log("Langpack Refresh Completed.");
	return Promise.resolve();
}

/**
 * Function for adding replacing ads language packs with vscode ones.
 * For new languages, remember to add to i18n.extraLanguages so that it will be recognized by ADS.
*/
export function renameVscodeLangpacks(): Promise<void> {
	let supportedLocations = [...i18n.defaultLanguages, ...i18n.extraLanguages];


	for (let i = 0; i < supportedLocations.length; i++) {
		let langId = supportedLocations[i].id;
		if (langId === "zh-cn") {
			langId = "zh-hans";
		}
		if (langId === "zh-tw") {
			langId = "zh-hant";
		}
		let locADSFolder = path.join('.', 'i18n', `ads-language-pack-${langId}`);
		let locVSCODEFolder = path.join('.', 'i18n', `vscode-language-pack-${langId}`);
		let translationDataFolder = path.join(locVSCODEFolder, 'translations');
		let xlfFolder = path.join('.', 'resources', 'xlf');
		try {
			fs.statSync(locVSCODEFolder);
		}
		catch {
			console.log('vscode pack is not in ADS yet: ' + langId);
			continue;
		}

		//Delete any erroneous zip files found in vscode folder.
		let globZipArray = glob.sync(path.join(locVSCODEFolder, '*.zip'));
		globZipArray.forEach(element => {
			fs.unlinkSync(element);
		});

		// Delete extension files in vscode language pack that are not in ADS.
		if (fs.existsSync(translationDataFolder)) {
			let totalExtensions = fs.readdirSync(path.join(translationDataFolder, 'extensions'));
			for (let extensionTag in totalExtensions) {
				let extensionFileName = totalExtensions[extensionTag];
				let shortExtensionFileName = extensionFileName.replace('ms-vscode.', 'vscode.').replace('vscode.', '');
				let xlfPath = path.join(xlfFolder, `${langId}`, shortExtensionFileName.replace('.i18n.json', '.xlf'));
				if (!(fs.existsSync(xlfPath) || VSCODEExtensions.indexOf(shortExtensionFileName.replace('.i18n.json', '')) !== -1)) {
					let filePath = path.join(translationDataFolder, 'extensions', extensionFileName);
					rimraf.sync(filePath);
				}
			}
		}

		//Get list of md files in ADS langpack, to copy to vscode langpack prior to renaming.
		let globMDArray = glob.sync(path.join(locADSFolder, '*.md'));

		//Copy MD files to vscode langpack.
		globMDArray.forEach(element => {
			fs.copyFileSync(element, path.join(locVSCODEFolder, path.parse(element).base));
		});

		//Copy yarn.lock (required for packaging task)
		let yarnLockPath = path.join(locADSFolder, 'yarn.lock');
		if (fs.existsSync(yarnLockPath)) {
			fs.copyFileSync(yarnLockPath, path.join(locVSCODEFolder, 'yarn.lock'));
		}

		//remove the ADS langpack, and finally rename the vscode langpack to match the ADS one.
		rimraf.sync(locADSFolder);
		fs.renameSync(locVSCODEFolder, locADSFolder);
	}

	console.log("Langpack Rename Completed.");
	return Promise.resolve();
}
