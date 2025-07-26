import { Plugin, Notice, MarkdownView, Workspace, loadMermaid } from "obsidian";
import {
	ConfluenceUploadSettings,
	Publisher,
	ConfluencePageConfig,
	StaticSettingsLoader,
	renderADFDoc,
	MermaidRendererPlugin,
	UploadAdfFileResult,
} from "@markdown-confluence/lib";
import { ElectronMermaidRenderer } from "@markdown-confluence/mermaid-electron-renderer";
import { ConfluenceSettingTab } from "./ConfluenceSettingTab";
import ObsidianAdaptor from "./adaptors/obsidian";
import { CompletedModal } from "./CompletedModal";
import { ObsidianConfluenceClient } from "./MyBaseClient";
import {
	ConfluencePerPageForm,
	ConfluencePerPageUIValues,
	mapFrontmatterToConfluencePerPageUIValues,
} from "./ConfluencePerPageForm";
import { PlantUMLRendererPlugin } from "./PlantUMLRendererPlugin";
import { Mermaid } from "mermaid";

export interface ObsidianPluginSettings
	extends ConfluenceUploadSettings.ConfluenceSettings {
	mermaidTheme:
		| "match-obsidian"
		| "light-obsidian"
		| "dark-obsidian"
		| "default"
		| "neutral"
		| "dark"
		| "forest";
	usePersonalAccessToken: boolean;
	personalAccessToken: string;
	useStorageFormat: boolean;
}

interface FailedFile {
	fileName: string;
	reason: string;
}

interface UploadResults {
	errorMessage: string | null;
	failedFiles: FailedFile[];
	filesUploadResult: UploadAdfFileResult[];
}

export default class ConfluencePlugin extends Plugin {
	settings!: ObsidianPluginSettings;
	private isSyncing = false;
	workspace!: Workspace;
	publisher!: Publisher;
	adaptor!: ObsidianAdaptor;

	activeLeafPath(workspace: Workspace) {
		return workspace.getActiveViewOfType(MarkdownView)?.file.path;
	}

	async init() {
		await this.loadSettings();
		const { vault, metadataCache, workspace } = this.app;
		this.workspace = workspace;
		this.adaptor = new ObsidianAdaptor(
			vault,
			metadataCache,
			this.settings,
			this.app,
		);

		const mermaidItems = await this.getMermaidItems();
		let mermaidRenderer;
		try {
			mermaidRenderer = new ElectronMermaidRenderer(
				mermaidItems.extraStyleSheets,
				mermaidItems.extraStyles,
				mermaidItems.mermaidConfig,
				mermaidItems.bodyStyles,
			);
		} catch (error: any) {
			console.warn('ElectronMermaidRenderer initialization failed, Mermaid charts may not render properly:', error);
			// Fallback: Create a dummy renderer that doesn't break the plugin
			mermaidRenderer = {
				captureMermaidCharts: async () => new Map()
			};
		}
		const confluenceClient = new ObsidianConfluenceClient({
			host: this.settings.confluenceBaseUrl,
			authentication: this.settings.usePersonalAccessToken
				? {
					personalAccessToken: this.settings.personalAccessToken,
				}
				: {
					basic: {
						email: this.settings.atlassianUserName,
						apiToken: this.settings.atlassianApiToken,
					},
				},
			middlewares: {
				onError(e: any) {
					if ("response" in e && "data" in e.response) {
						e.message =
							typeof e.response.data === "string"
								? e.response.data
								: JSON.stringify(e.response.data);
					}
				},
			},
		});


		const settingsLoader = new StaticSettingsLoader(this.settings);
		
		// For PAT authentication with Confluence Server, we need to handle user info differently
		// The Publisher expects accountId but Server uses userKey
		if (this.settings.usePersonalAccessToken) {
			// Helper function to recursively map userKey to accountId in any object
			const mapUserKeys = (obj: any): any => {
				if (!obj || typeof obj !== 'object') return obj;
				
				if (Array.isArray(obj)) {
					return obj.map(mapUserKeys);
				}
				
				const result = { ...obj };
				
				// If this looks like a user object, map userKey to accountId
				if (result.userKey && !result.accountId) {
					// Mapping userKey to accountId
					result.accountId = result.userKey;
				}
				
				// Recursively process all properties
				for (const key in result) {
					if (result.hasOwnProperty(key) && typeof result[key] === 'object') {
						result[key] = mapUserKeys(result[key]);
					}
				}
				
				return result;
			};

			// Patch the users API getCurrentUser method
			const usersApi = (confluenceClient.users as any);
			if (usersApi.getCurrentUser) {
				const originalGetCurrentUser = usersApi.getCurrentUser;
				usersApi.getCurrentUser = async function(params?: any) {
					const user = await originalGetCurrentUser.call(this, params || {});
					const mappedUser = mapUserKeys(user);
					return mappedUser;
				};
			}

			// Patch the content API methods that return page information with user data
			const contentApi = confluenceClient.content as any;
			if (contentApi.getContentById) {
				const originalGetContentById = contentApi.getContentById;
				contentApi.getContentById = async function(params?: any) {
					const content = await originalGetContentById.call(this, params || {});
					return mapUserKeys(content);
				};
			}

			if (contentApi.updateContent) {
				const originalUpdateContent = contentApi.updateContent;
				contentApi.updateContent = async function(params?: any) {
					const content = await originalUpdateContent.call(this, params || {});
					return mapUserKeys(content);
				};
			}

			if (contentApi.createContent) {
				const originalCreateContent = contentApi.createContent;
				contentApi.createContent = async function(params?: any) {
					const content = await originalCreateContent.call(this, params || {});
					return mapUserKeys(content);
				};
			}
		}

		// Patch Publisher to use storage format instead of ADF for Confluence Server compatibility
		if (this.settings.useStorageFormat) {
			// Simple ADF to storage format converter
			const adfToStorageFormat = (adf: any): string => {
				if (!adf || !adf.content) return '';
				
				// Helper function to escape XML content
				const escapeXML = (str: string): string => {
					return str
						.replace(/&/g, '&amp;')
						.replace(/</g, '&lt;')
						.replace(/>/g, '&gt;')
						.replace(/"/g, '&quot;')
						.replace(/'/g, '&apos;');
				};
				
				// Helper function to safely wrap content in CDATA
				const wrapCDATA = (content: string): string => {
					// If content contains ]]>, we need to split it
					if (content.includes(']]>')) {
						// Split CDATA sections when ]]> is present
						return content.split(']]>').map(part => `<![CDATA[${part}]]>`).join(']]&gt;<![CDATA[');
					}
					return `<![CDATA[${content}]]>`;
				};
				
				// Helper function to convert tables
				const convertTable = (tableNode: any): string => {
					if (!tableNode || !tableNode.content) return '';
					
					const tableContent = tableNode.content.map(convertNode).join('');
					return `<table><tbody>${tableContent}</tbody></table>`;
				};
				
				const convertNode = (node: any): string => {
					if (!node || !node.type) return '';
					
					switch (node.type) {
						case 'paragraph':
							const content = node.content?.map(convertNode).join('') || '';
							return `<p>${content}</p>`;
						case 'text':
							return escapeXML(node.text || '');
						case 'hardBreak':
							return '<br/>';
						case 'heading':
							const level = node.attrs?.level || 1;
							const headingContent = node.content?.map(convertNode).join('') || '';
							return `<h${level}>${headingContent}</h${level}>`;
						case 'codeBlock':
							// For code blocks, don't escape the content - CDATA will handle it
							const codeContent = node.content?.map((n: any) => n.text || '').join('') || '';
							const language = node.attrs?.language || '';
							let macro = `<ac:structured-macro ac:name="code">`;
							if (language) {
								macro += `<ac:parameter ac:name="language">${escapeXML(language)}</ac:parameter>`;
							}
							macro += `<ac:plain-text-body>${wrapCDATA(codeContent)}</ac:plain-text-body></ac:structured-macro>`;
							return macro;
						case 'table':
							return convertTable(node);
						case 'tableRow':
							const rowContent = node.content?.map(convertNode).join('') || '';
							return `<tr>${rowContent}</tr>`;
						case 'tableHeader':
							const headerContent = node.content?.map(convertNode).join('') || '';
							return `<th>${headerContent}</th>`;
						case 'tableCell':
							const cellContent = node.content?.map(convertNode).join('') || '';
							return `<td>${cellContent}</td>`;
						case 'bulletList':
							const bulletListContent = node.content?.map(convertNode).join('') || '';
							return `<ul>${bulletListContent}</ul>`;
						case 'orderedList':
							const orderedListContent = node.content?.map(convertNode).join('') || '';
							return `<ol>${orderedListContent}</ol>`;
						case 'listItem':
							const listItemContent = node.content?.map(convertNode).join('') || '';
							return `<li>${listItemContent}</li>`;
						case 'extension':
							// Handle PlantUML and other extensions
							if (node.attrs?.extensionKey === 'plantuml') {
								const plantUMLContent = node.content?.[0]?.content?.[0]?.text || '';
								
								// Get diagram name from macro parameters (set by PlantUMLRendererPlugin)
								const macroParams = node.attrs?.parameters?.macroParams || {};
								const diagramName = macroParams.title || '';
								
								
								// Build the macro with optional name parameter
								let macro = `<ac:structured-macro ac:name="plantuml" ac:schema-version="1">`;
								macro += `<ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter>`;
								if (diagramName) {
									macro += `<ac:parameter ac:name="title">${escapeXML(diagramName)}</ac:parameter>`;
								}
								macro += `<ac:plain-text-body>${wrapCDATA(plantUMLContent)}</ac:plain-text-body>`;
								macro += `</ac:structured-macro>`;
								
								return macro;
							}
							return '';
						default:
							// For unknown nodes, try to process their content
							if (node.content) {
								return node.content.map(convertNode).join('');
							}
							return '';
					}
				};
				
				return adf.content.map(convertNode).join('');
			};
			
			// Patch the content API to convert ADF to storage format before sending
			const contentApi = confluenceClient.content as any;
			
			if (contentApi.createContent) {
				const originalCreateContent = contentApi.createContent;
				contentApi.createContent = async function(params: any) {
					if (params.body?.atlas_doc_format?.value) {
						// Convert ADF to storage format
						const adfContent = JSON.parse(params.body.atlas_doc_format.value);
						const storageContent = adfToStorageFormat(adfContent);
						
						// Replace ADF with storage format
						params.body = {
							storage: {
								value: storageContent,
								representation: "storage"
							}
						};
						delete params.body.atlas_doc_format;
					}
					return await originalCreateContent.call(this, params);
				};
			}

			if (contentApi.updateContent) {
				const originalUpdateContent = contentApi.updateContent;
				contentApi.updateContent = async function(params: any) {
					console.log('updateContent called with params:', JSON.stringify(params, null, 2));
					if (params.body?.atlas_doc_format?.value) {
						// Convert ADF to storage format
						const adfContent = JSON.parse(params.body.atlas_doc_format.value);
						const storageContent = adfToStorageFormat(adfContent);
						
						// Replace ADF with storage format
						params.body = {
							storage: {
								value: storageContent,
								representation: "storage"
							}
						};
						delete params.body.atlas_doc_format;
						console.log('Updated params after conversion:', JSON.stringify(params, null, 2));
					} else {
						console.log('No ADF content found in updateContent params');
					}
					return await originalUpdateContent.call(this, params);
				};
			}
		}
		
		this.publisher = new Publisher(
			this.adaptor,
			settingsLoader,
			confluenceClient,
			[
				new MermaidRendererPlugin(mermaidRenderer),
				new PlantUMLRendererPlugin(),
			],
		);
	}

	async getMermaidItems() {
		const extraStyles: string[] = [];
		const extraStyleSheets: string[] = [];
		let bodyStyles = "";
		const body = document.querySelector("body") as HTMLBodyElement;

		switch (this.settings.mermaidTheme) {
			case "default":
			case "neutral":
			case "dark":
			case "forest":
				return {
					extraStyleSheets,
					extraStyles,
					mermaidConfig: { theme: this.settings.mermaidTheme },
					bodyStyles,
				};
			case "match-obsidian":
				bodyStyles = body.className;
				break;
			case "dark-obsidian":
				bodyStyles = "theme-dark";
				break;
			case "light-obsidian":
				bodyStyles = "theme-dark";
				break;
			default:
				throw new Error("Missing theme");
		}

		extraStyleSheets.push("app://obsidian.md/app.css");

		// @ts-expect-error
		const cssTheme = this.app.vault?.getConfig("cssTheme") as string;
		if (cssTheme) {
			const fileExists = await this.app.vault.adapter.exists(
				`.obsidian/themes/${cssTheme}/theme.css`,
			);
			if (fileExists) {
				const themeCss = await this.app.vault.adapter.read(
					`.obsidian/themes/${cssTheme}/theme.css`,
				);
				extraStyles.push(themeCss);
			}
		}

		const cssSnippets =
			// @ts-expect-error
			(this.app.vault?.getConfig("enabledCssSnippets") as string[]) ?? [];
		for (const snippet of cssSnippets) {
			const fileExists = await this.app.vault.adapter.exists(
				`.obsidian/snippets/${snippet}.css`,
			);
			if (fileExists) {
				const themeCss = await this.app.vault.adapter.read(
					`.obsidian/snippets/${snippet}.css`,
				);
				extraStyles.push(themeCss);
			}
		}

		return {
			extraStyleSheets,
			extraStyles,
			mermaidConfig: (
				(await loadMermaid()) as Mermaid
			).mermaidAPI.getConfig(),
			bodyStyles,
		};
	}

	async doPublish(publishFilter?: string): Promise<UploadResults> {
		const adrFiles = await this.publisher.publish(publishFilter);

		const returnVal: UploadResults = {
			errorMessage: null,
			failedFiles: [],
			filesUploadResult: [],
		};

		adrFiles.forEach((element) => {
			if (element.successfulUploadResult) {
				returnVal.filesUploadResult.push(
					element.successfulUploadResult,
				);
				return;
			}

			returnVal.failedFiles.push({
				fileName: element.node.file.absoluteFilePath,
				reason: element.reason ?? "No Reason Provided",
			});
		});

		return returnVal;
	}

	override async onload() {
		await this.init();

		this.addRibbonIcon("cloud", "Publish to Confluence", async () => {
			if (this.isSyncing) {
				new Notice("Syncing already on going");
				return;
			}
			this.isSyncing = true;
			try {
				const stats = await this.doPublish();
				new CompletedModal(this.app, {
					uploadResults: stats,
				}).open();
			} catch (error) {
				if (error instanceof Error) {
					new CompletedModal(this.app, {
						uploadResults: {
							errorMessage: error.message,
							failedFiles: [],
							filesUploadResult: [],
						},
					}).open();
				} else {
					new CompletedModal(this.app, {
						uploadResults: {
							errorMessage: JSON.stringify(error),
							failedFiles: [],
							filesUploadResult: [],
						},
					}).open();
				}
			} finally {
				this.isSyncing = false;
			}
		});

		this.addCommand({
			id: "adf-to-markdown",
			name: "ADF To Markdown",
			callback: async () => {
				const confluenceClient = new ObsidianConfluenceClient({
					host: this.settings.confluenceBaseUrl,
					authentication: {
						basic: {
							email: this.settings.atlassianUserName,
							apiToken: this.settings.atlassianApiToken,
						},
					},
				});
				const testingPage =
					await confluenceClient.content.getContentById({
						id: "9732097",
						expand: ["body.atlas_doc_format", "space"],
					});
				const adf = JSON.parse(
					testingPage.body?.atlas_doc_format?.value ||
						'{type: "doc", content:[]}',
				);
				renderADFDoc(adf);
			},
		});

		this.addCommand({
			id: "publish-current",
			name: "Publish Current File to Confluence",
			checkCallback: (checking: boolean) => {
				if (!this.isSyncing) {
					if (!checking) {
						this.isSyncing = true;
						this.doPublish(this.activeLeafPath(this.workspace))
							.then((stats) => {
								new CompletedModal(this.app, {
									uploadResults: stats,
								}).open();
							})
							.catch((error) => {
								if (error instanceof Error) {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: error.message,
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								} else {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: JSON.stringify(error),
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								}
							})
							.finally(() => {
								this.isSyncing = false;
							});
					}
					return true;
				}
				return true;
			},
		});

		this.addCommand({
			id: "publish-all",
			name: "Publish All to Confluence",
			checkCallback: (checking: boolean) => {
				if (!this.isSyncing) {
					if (!checking) {
						this.isSyncing = true;
						this.doPublish()
							.then((stats) => {
								new CompletedModal(this.app, {
									uploadResults: stats,
								}).open();
							})
							.catch((error) => {
								if (error instanceof Error) {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: error.message,
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								} else {
									new CompletedModal(this.app, {
										uploadResults: {
											errorMessage: JSON.stringify(error),
											failedFiles: [],
											filesUploadResult: [],
										},
									}).open();
								}
							})
							.finally(() => {
								this.isSyncing = false;
							});
					}
				}
				return true;
			},
		});

		this.addCommand({
			id: "enable-publishing",
			name: "Enable publishing to Confluence",
			editorCheckCallback: (checking, _editor, view) => {
				if (!view.file) {
					return false;
				}

				if (checking) {
					const frontMatter = this.app.metadataCache.getCache(
						view.file.path,
					)?.frontmatter;
					const file = view.file;
					const enabledForPublishing =
						(file.path.startsWith(this.settings.folderToPublish) &&
							(!frontMatter ||
								frontMatter["connie-publish"] !== false)) ||
						(frontMatter && frontMatter["connie-publish"] === true);
					return !enabledForPublishing;
				}

				this.app.fileManager.processFrontMatter(
					view.file,
					(frontmatter) => {
						if (
							view.file &&
							view.file.path.startsWith(
								this.settings.folderToPublish,
							)
						) {
							delete frontmatter["connie-publish"];
						} else {
							frontmatter["connie-publish"] = true;
						}
					},
				);
				return true;
			},
		});

		this.addCommand({
			id: "disable-publishing",
			name: "Disable publishing to Confluence",
			editorCheckCallback: (checking, _editor, view) => {
				if (!view.file) {
					return false;
				}

				if (checking) {
					const frontMatter = this.app.metadataCache.getCache(
						view.file.path,
					)?.frontmatter;
					const file = view.file;
					const enabledForPublishing =
						(file.path.startsWith(this.settings.folderToPublish) &&
							(!frontMatter ||
								frontMatter["connie-publish"] !== false)) ||
						(frontMatter && frontMatter["connie-publish"] === true);
					return enabledForPublishing;
				}

				this.app.fileManager.processFrontMatter(
					view.file,
					(frontmatter) => {
						if (
							view.file &&
							view.file.path.startsWith(
								this.settings.folderToPublish,
							)
						) {
							frontmatter["connie-publish"] = false;
						} else {
							delete frontmatter["connie-publish"];
						}
					},
				);
				return true;
			},
		});

		this.addCommand({
			id: "page-settings",
			name: "Update Confluence Page Settings",
			editorCallback: (_editor, view) => {
				if (!view.file) {
					return false;
				}

				const frontMatter = this.app.metadataCache.getCache(
					view.file.path,
				)?.frontmatter;

				const file = view.file;

				new ConfluencePerPageForm(this.app, {
					config: ConfluencePageConfig.conniePerPageConfig,
					initialValues:
						mapFrontmatterToConfluencePerPageUIValues(frontMatter),
					onSubmit: (values, close) => {
						const valuesToSet: Partial<ConfluencePageConfig.ConfluencePerPageAllValues> =
							{};
						for (const propertyKey in values) {
							if (
								Object.prototype.hasOwnProperty.call(
									values,
									propertyKey,
								)
							) {
								const element =
									values[
										propertyKey as keyof ConfluencePerPageUIValues
									];
								if (element.isSet) {
									valuesToSet[
										propertyKey as keyof ConfluencePerPageUIValues
									] = element.value as never;
								}
							}
						}
						this.adaptor.updateMarkdownValues(
							file.path,
							valuesToSet,
						);
						close();
					},
				}).open();
				return true;
			},
		});

		this.addSettingTab(new ConfluenceSettingTab(this.app, this));
	}

	override async onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			ConfluenceUploadSettings.DEFAULT_SETTINGS,
			{ 
				mermaidTheme: "match-obsidian",
				usePersonalAccessToken: false,
				personalAccessToken: "",
				useStorageFormat: true, // Default to true for Confluence Server compatibility
			},
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		await this.init();
	}
}
