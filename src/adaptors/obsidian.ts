import { Vault, MetadataCache, App, TFile } from "obsidian";
import {
	ConfluenceUploadSettings,
	BinaryFile,
	FilesToUpload,
	LoaderAdaptor,
	MarkdownFile,
	ConfluencePageConfig,
} from "@markdown-confluence/lib";
import { lookup } from "mime-types";

export default class ObsidianAdaptor implements LoaderAdaptor {
	vault: Vault;
	metadataCache: MetadataCache;
	settings: ConfluenceUploadSettings.ConfluenceSettings;
	app: App;

	constructor(
		vault: Vault,
		metadataCache: MetadataCache,
		settings: ConfluenceUploadSettings.ConfluenceSettings,
		app: App,
	) {
		this.vault = vault;
		this.metadataCache = metadataCache;
		this.settings = settings;
		this.app = app;
	}

	async getMarkdownFilesToUpload(): Promise<FilesToUpload> {
		const files = this.vault.getMarkdownFiles();
		const filesToPublish = [];
		for (const file of files) {
			try {
				if (file.path.endsWith(".excalidraw")) {
					continue;
				}

				const fileFM = this.metadataCache.getCache(file.path);
				if (!fileFM) {
					throw new Error("Missing File in Metadata Cache");
				}
				const frontMatter = fileFM.frontmatter;

				if (
					(file.path.startsWith(this.settings.folderToPublish) &&
						(!frontMatter ||
							frontMatter["connie-publish"] !== false)) ||
					(frontMatter && frontMatter["connie-publish"] === true)
				) {
					filesToPublish.push(file);
				}
			} catch {
				//ignore
			}
		}
		const filesToUpload = [];

		for (const file of filesToPublish) {
			const markdownFile = await this.loadMarkdownFile(file.path);
			filesToUpload.push(markdownFile);
		}

		return filesToUpload;
	}

	async loadMarkdownFile(absoluteFilePath: string): Promise<MarkdownFile> {
		const file = this.app.vault.getAbstractFileByPath(absoluteFilePath);
		if (!(file instanceof TFile)) {
			throw new Error("Not a TFile");
		}

		const fileFM = this.metadataCache.getCache(file.path);
		if (!fileFM) {
			throw new Error("Missing File in Metadata Cache");
		}
		const frontMatter = fileFM.frontmatter;

		const parsedFrontMatter: Record<string, unknown> = {};
		if (frontMatter) {
			for (const [key, value] of Object.entries(frontMatter)) {
				parsedFrontMatter[key] = value;
			}
		}

		let contents = await this.vault.cachedRead(file);
		
		// Process PlantUML file transclusions
		contents = await this.processPlantumlTransclusions(contents, file.path);
		
		return {
			pageTitle: file.basename,
			folderName: file.parent.name,
			absoluteFilePath: file.path,
			fileName: file.name,
			contents: contents,
			frontmatter: parsedFrontMatter,
		};
	}

	async readBinary(
		path: string,
		referencedFromFilePath: string,
	): Promise<BinaryFile | false> {
		const testing = this.metadataCache.getFirstLinkpathDest(
			path,
			referencedFromFilePath,
		);
		if (testing) {
			const files = await this.vault.readBinary(testing);
			const mimeType =
				lookup(testing.extension) || "application/octet-stream";
			return {
				contents: files,
				filePath: testing.path,
				filename: testing.name,
				mimeType: mimeType,
			};
		}

		return false;
	}
	
	async processPlantumlTransclusions(contents: string, currentFilePath: string): Promise<string> {
		// Match Obsidian's transclusion syntax: ![[filename.puml]] or ![[filename.puml|alias]]
		// Can appear anywhere in the line
		const transclusionRegex = /!\[\[([^\]]+\.puml)(?:\|[^\]]+)?\]\]/g;
		
		
		let processedContents = contents;
		let match: RegExpExecArray | null;
		const matches: Array<{fullMatch: string, transcludedPath: string, index: number}> = [];
		
		// First, collect all matches
		while ((match = transclusionRegex.exec(contents)) !== null) {
			matches.push({
				fullMatch: match[0],
				transcludedPath: match[1],
				index: match.index
			});
		}
		
		
		// Process each match
		for (const matchInfo of matches) {
			const { fullMatch, transcludedPath } = matchInfo;
			
			// Resolve the file path
			const transcludedFile = this.metadataCache.getFirstLinkpathDest(
				transcludedPath,
				currentFilePath
			);
			
			if (transcludedFile) {
				try {
					// Read the PlantUML file contents
					const pumlContent = await this.vault.cachedRead(transcludedFile);
					
					// Convert to a PlantUML code block
					const codeBlock = `\`\`\`plantuml\n${pumlContent}\n\`\`\``;
					
					// Replace the transclusion with the code block
					processedContents = processedContents.replace(fullMatch, codeBlock);
				} catch (error) {
					// If we can't read the file, leave the transclusion as-is
				}
			} else {
			}
		}
		
		return processedContents;
	}
	
	async updateMarkdownValues(
		absoluteFilePath: string,
		values: Partial<ConfluencePageConfig.ConfluencePerPageAllValues>,
	): Promise<void> {
		const config = ConfluencePageConfig.conniePerPageConfig;
		const file = this.app.vault.getAbstractFileByPath(absoluteFilePath);
		if (file instanceof TFile) {
			this.app.fileManager.processFrontMatter(file, (fm) => {
				for (const propertyKey in config) {
					if (!Object.prototype.hasOwnProperty.call(config, propertyKey)) {
						continue;
					}

					const { key } =
						config[
							propertyKey as keyof ConfluencePageConfig.ConfluencePerPageConfig
						];
					const value =
						values[
							propertyKey as keyof ConfluencePageConfig.ConfluencePerPageAllValues
						];
					if (propertyKey in values) {
						fm[key] = value;
					}
				}
			});
		}
	}
}
