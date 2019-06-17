/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IProductService = createDecorator<IProductService>('productService');

export interface IProductService {
	_serviceBrand: any;

	version: string;
	commit?: string;

	nameLong: string;
	urlProtocol: string;
	extensionAllowedProposedApi: string[];
	uiExtensions?: string[];

	enableTelemetry: boolean;
	extensionsGallery?: {
		serviceUrl: string;
		itemUrl: string;
		controlUrl: string;
		recommendationsUrl: string;
	};

	sendASmile?: {
		reportIssueUrl: string;
		requestFeatureUrl: string;
	};
}
