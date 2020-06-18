/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ResourceType } from '../../constants';
import { TreeNode } from './treeNode';
import { MiaaModel } from '../../models/miaaModel';
import { ControllerModel } from '../../models/controllerModel';
import { MiaaDashboard } from '../dashboards/miaa/miaaDashboard';

/**
 * The TreeNode for displaying a SQL Managed Instance on Azure Arc
 */
export class MiaaTreeNode extends TreeNode {

	constructor(private _model: MiaaModel, private _controllerModel: ControllerModel) {
		super(_model.name, vscode.TreeItemCollapsibleState.None, ResourceType.sqlManagedInstances);
	}

	public async openDashboard(): Promise<void> {
		const miaaDashboard = new MiaaDashboard(this._controllerModel, this._model);
		await Promise.all([
			miaaDashboard.showDashboard(),
			this._model.refresh()]);
	}
}
