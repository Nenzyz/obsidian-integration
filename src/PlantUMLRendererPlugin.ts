import { traverse } from "@atlaskit/adf-utils/traverse";
import { JSONDocNode } from "@atlaskit/editor-json-transformer";
import { ADFProcessingPlugin, PublisherFunctions } from "@markdown-confluence/lib";
import { ADFEntity } from "@atlaskit/adf-utils/types";

/**
 * PlantUML Renderer Plugin that converts PlantUML code blocks to Confluence extension nodes
 * This approach leverages Confluence's native PlantUML support through extensions.
 */
export class PlantUMLRendererPlugin implements ADFProcessingPlugin<void, void> {
	
	extract(_adf: JSONDocNode): void {
		// No extraction needed for macro conversion
		return;
	}

	async transform(_items: void, _supportFunctions: PublisherFunctions): Promise<void> {
		// No transformation needed for macro conversion
		return;
	}
	
	load(adf: JSONDocNode, _data: void): JSONDocNode {
		let afterAdf = adf as ADFEntity;

		afterAdf = traverse(afterAdf, {
			codeBlock: (node, _parent) => {
				const language = node?.attrs?.["language"];
				if (language === "plantuml" || 
				    language === "plantuml-svg" || 
				    language === "plantuml-ascii") {
					const plantUMLContent = node?.content?.at(0)?.text;
					if (!plantUMLContent) {
						return node;
					}

					// Extract diagram name and clean up PlantUML content
					const lines = plantUMLContent.split('\n');
					let diagramName = '';
					
					console.log('PlantUML original content:', plantUMLContent);
					
					// Check if it starts with @startuml and has a name
					if (lines.length > 0 && lines[0].trim().match(/^\s*@startuml/i)) {
						const startLine = lines[0].trim();
						console.log('Start line:', startLine);
						const nameMatch = startLine.match(/@startuml\s+(.+)/i);
						if (nameMatch) {
							diagramName = nameMatch[1].trim();
							console.log('Extracted diagram name from @startuml:', diagramName);
						}
					} else {
						// If it doesn't start with @startuml, check for title directive or use first line
						console.log('Content does not start with @startuml, checking for title directive or first line as title');
						
						// Look for 'title' directive in the content
						let titleDirectiveFound = false;
						for (let i = 0; i < lines.length; i++) {
							const line = lines[i].trim();
							if (line.startsWith('title ')) {
								diagramName = line.substring(6).trim();
								console.log('Extracted diagram name from title directive:', diagramName);
								titleDirectiveFound = true;
								break;
							}
						}
						
						// If no title directive found and first line doesn't look like UML syntax, use it as title
						if (!titleDirectiveFound && lines.length > 0) {
							const firstLine = lines[0].trim();
							// Check if first line looks like a title (doesn't start with UML keywords)
							const umlKeywords = ['!theme', 'skinparam', 'package', 'class', 'interface', 'enum', 'actor', 'participant', 'note', '@startuml', '@enduml'];
							const isUmlSyntax = umlKeywords.some(keyword => firstLine.startsWith(keyword));
							
							if (!isUmlSyntax && firstLine.length > 0) {
								diagramName = firstLine;
								console.log('Using first line as diagram name:', diagramName);
							}
						}
					}

					// Clean up PlantUML content - remove @startuml/@enduml if present
					// as Confluence macro doesn't need them
					let cleanContent = plantUMLContent
						.replace(/^\s*@startuml.*?\n?/i, '')
						.replace(/\n?\s*@enduml\s*$/i, '')
						.trim();

					// Remove title directive from content if we found one
					if (diagramName) {
						const titleLines = cleanContent.split('\n');
						const filteredLines = titleLines.filter(line => {
							const trimmedLine = line.trim();
							// Remove title directive
							if (trimmedLine.startsWith('title ')) {
								return false;
							}
							// Remove first line if it matches our extracted diagram name and doesn't look like UML syntax
							const umlKeywords = ['!theme', 'skinparam', 'package', 'class', 'interface', 'enum', 'actor', 'participant', 'note', '@startuml', '@enduml'];
							const isUmlSyntax = umlKeywords.some(keyword => trimmedLine.startsWith(keyword));
							if (!isUmlSyntax && trimmedLine === diagramName) {
								return false;
							}
							return true;
						});
						cleanContent = filteredLines.join('\n').trim();
					}

					// If the content is empty after cleanup, keep original
					if (!cleanContent) {
						cleanContent = plantUMLContent;
					}

					// Transform to Confluence extension node for PlantUML
					// Based on the provided storage format sample:
					// <ac:structured-macro ac:name="plantuml" ac:schema-version="1">
					//   <ac:parameter ac:name="atlassian-macro-output-type">INLINE</ac:parameter>
					//   <ac:plain-text-body><![CDATA[...]]></ac:plain-text-body>
					// </ac:structured-macro>
					// Build macro parameters
					const macroParams: { [key: string]: string } = {
						"atlassian-macro-output-type": "INLINE"
					};
					
					// Add title parameter if we extracted a diagram name
					if (diagramName) {
						macroParams.title = diagramName;
						console.log('Adding title parameter to PlantUML macro:', diagramName);
					}

					return {
						type: "extension",
						attrs: {
							extensionType: "com.atlassian.confluence.macro.core",
							extensionKey: "plantuml",
							parameters: {
								macroParams: macroParams
							},
							layout: "default"
						},
						content: [
							{
								type: "paragraph",
								content: [
									{
										type: "text",
										text: cleanContent
									}
								]
							}
						]
					};
				}
				return node;
			},
		}) || afterAdf;

		return afterAdf as JSONDocNode;
	}
}