/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, IActionItem, IActionRunner } from 'vs/base/common/actions';
import { TPromise } from 'vs/base/common/winjs.base';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IQueryModelService } from 'sql/parts/query/execution/queryModel';
import { SelectBox } from 'sql/base/browser/ui/selectBox/selectBox';
import { EventEmitter } from 'sql/base/common/eventEmitter';
import { IConnectionManagementService } from 'sql/parts/connection/common/connectionManagement';
import { EditDataEditor } from 'sql/parts/editData/editor/editDataEditor';
import nls = require('vs/nls');
import * as dom from 'vs/base/browser/dom';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { INotificationService, INotificationActions } from 'vs/platform/notification/common/notification';
import Severity from 'vs/base/common/severity';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
const $ = dom.$;

/**
 * Action class that edit data based actions will extend
 */
export abstract class EditDataAction extends Action {

	private _classes: string[];

	constructor(protected editor: EditDataEditor, id: string, enabledClass: string,
		@IConnectionManagementService private _connectionManagementService: IConnectionManagementService) {
		super(id);
		this.enabled = true;
		this.setClass(enabledClass);
	}

	/**
	 * This method is executed when the button is clicked.
	 */
	public abstract run(): TPromise<void>;

	protected setClass(enabledClass: string): void {
		this._classes = [];

		if (enabledClass) {
			this._classes.push(enabledClass);
		}
		this.class = this._classes.join(' ');
	}

	/**
	 * Returns the URI of the given editor if it is not undefined and is connected.
	 */
	public isConnected(editor: EditDataEditor): boolean {
		if (!editor || !editor.uri) {
			return false;
		}
		return this._connectionManagementService.isConnected(editor.uri);
	}
}

/**
 * Action class that refreshes the table for an edit data session
 */
export class RefreshTableAction extends EditDataAction {
	private static EnabledClass = 'start';
	public static ID = 'refreshTableAction';

	constructor(editor: EditDataEditor,
		@IQueryModelService private _queryModelService: IQueryModelService,
		@IConnectionManagementService _connectionManagementService: IConnectionManagementService,
		@INotificationService private _notificationService: INotificationService,
	) {
		super(editor, RefreshTableAction.ID, RefreshTableAction.EnabledClass, _connectionManagementService);
		this.label = nls.localize('editData.run', 'Run');
	}

	public run(): TPromise<void> {
		if (this.isConnected(this.editor)) {
			let input = this.editor.editDataInput;

			let rowLimit: number = undefined;
			let queryString: string = undefined;
			if (input.queryPaneEnabled) {
				queryString = input.queryString = this.editor.getEditorText();
				if (!this.IsQueryStringValid(input.queryString, input.tableName)) {
					return TPromise.as(null);
				}
			} else {
				rowLimit = input.rowLimit;
			}

			this._queryModelService.disposeEdit(input.uri).then((result) => {
				this._queryModelService.initializeEdit(input.uri, input.schemaName, input.tableName, input.objectType, rowLimit, queryString);
				input.showResultsEditor();
			}, error => {
				this._notificationService.notify({
					severity: Severity.Error,
					message: nls.localize('disposeEditFailure', 'Dispose Edit Failed With Error: ') + error
				});
			});
		}
		return TPromise.as(null);
	}

	private IsQueryStringValid(queryString: string, tableName: string): boolean {
		if (queryString) {
			let lowerCaseStr = queryString.toLocaleLowerCase();
			let fromIndex = lowerCaseStr.search(/\s(from)\s/);

			if (fromIndex === -1) {
				this._notificationService.notify({
					severity: Severity.Error,
					message: nls.localize('noFromClauseFailure', 'Edit Data query has no FROM clause.')
				});
				return false;
			}

			let afterFromStr = lowerCaseStr.substring(fromIndex + 5);
			if (afterFromStr.search(/\s(group by)\s/) >= 0 || afterFromStr.search(/\s(having)\s/) >= 0) {
				this._notificationService.notify({
					severity: Severity.Error,
					message: nls.localize('aggregateNotSupportedFailure', 'Edit Data queries do not support aggregated results.')
				});
				return false;
			}

			let whereIndex = afterFromStr.search(/\s(where)\s/);
			let orderByIndex = afterFromStr.search(/\s(order by)\s/);
			let optionIndex = afterFromStr.search(/\s(option)\s/);
			let end = Math.min.apply(null, [ whereIndex, orderByIndex, optionIndex ].filter(index => index > 0));
			let queryTablesStr = afterFromStr.substring(0, end !== NaN ? end : undefined);

			let errorMsg: string = undefined;
			if (!queryTablesStr.includes(tableName.toLocaleLowerCase())) {
				errorMsg = nls.localize('wrongTableNameFailure', 'Edit Data query did not contain original table name.');
			} else if ((queryTablesStr.match(/,/g) || []).length > 0) {
				errorMsg = nls.localize('multipleTableNamesFailure', 'Edit Data queries do not support querying from multiple tables.');
			}

			if (errorMsg) {
				this._notificationService.notify({
					severity: Severity.Error,
					message: errorMsg
				});
				return false;
			}
		}

		return true;
	}
}

/**
 * Action class that cancels the refresh data trigger in an edit data session
 */
export class StopRefreshTableAction extends EditDataAction {

	private static EnabledClass = 'stop';
	public static ID = 'stopRefreshAction';

	constructor(editor: EditDataEditor,
		@IQueryModelService private _queryModelService: IQueryModelService,
		@IConnectionManagementService _connectionManagementService: IConnectionManagementService
	) {
		super(editor, StopRefreshTableAction.ID, StopRefreshTableAction.EnabledClass, _connectionManagementService);
		this.enabled = false;
		this.label = nls.localize('editData.stop', 'Stop');
	}

	public run(): TPromise<void> {
		let input = this.editor.editDataInput;
		this._queryModelService.disposeEdit(input.uri);
		return TPromise.as(null);
	}
}

/**
 * Action class that is tied with ChangeMaxRowsActionItem
 */
export class ChangeMaxRowsAction extends EditDataAction {

	private static EnabledClass = '';
	public static ID = 'changeMaxRowsAction';

	constructor(editor: EditDataEditor,
		@IQueryModelService private _queryModelService: IQueryModelService,
		@IConnectionManagementService _connectionManagementService: IConnectionManagementService
	) {
		super(editor, ChangeMaxRowsAction.ID, undefined, _connectionManagementService);
		this.enabled = false;
		this.class = ChangeMaxRowsAction.EnabledClass;
	}

	public run(): TPromise<void> {

		return TPromise.as(null);
	}
}

/*
 * Action item that handles the dropdown (combobox) that lists the avaliable number of row selections
 * for an edit data session
 */
export class ChangeMaxRowsActionItem extends EventEmitter implements IActionItem {

	public actionRunner: IActionRunner;
	public defaultRowCount: number;
	private container: HTMLElement;
	private start: HTMLElement;
	private selectBox: SelectBox;
	private toDispose: IDisposable[];
	private context: any;
	private _options: string[];
	private _currentOptionsIndex: number;

	constructor(
		private _editor: EditDataEditor,
		@IContextViewService contextViewService: IContextViewService,
		@IThemeService private _themeService: IThemeService) {
		super();
		this._options = ['200', '1000', '10000'];
		this._currentOptionsIndex = 0;
		this.toDispose = [];
		this.selectBox = new SelectBox(this._options, this._options[this._currentOptionsIndex], contextViewService);
		this._registerListeners();
		this._refreshOptions();
		this.defaultRowCount = Number(this._options[this._currentOptionsIndex]);

		this.toDispose.push(styler.attachSelectBoxStyler(this.selectBox, themeService));
	}

	public render(container: HTMLElement): void {
		this.container = container;
		this.selectBox.render(dom.append(container, $('.configuration.listDatabasesSelectBox')));
	}

	public setActionContext(context: any): void {
		this.context = context;
	}

	public isEnabled(): boolean {
		return true;
	}

	public enable(): void {
		this.selectBox.enable();
	}

	public disable(): void {
		this.selectBox.disable();
	}

	public set setCurrentOptionIndex(selection: number) {
		this._currentOptionsIndex = this._options.findIndex(x => x === selection.toString());
		this._refreshOptions();
	}

	public focus(): void {
		this.start.focus();
	}

	public blur(): void {
		this.container.blur();
	}

	public dispose(): void {
		this.toDispose = dispose(this.toDispose);
	}

	private _refreshOptions(databaseIndex?: number): void {
		this.selectBox.setOptions(this._options, this._currentOptionsIndex);
	}

	private _registerListeners(): void {
		this.toDispose.push(this.selectBox.onDidSelect(selection => {
			this._currentOptionsIndex = this._options.findIndex(x => x === selection.selected);
			this._editor.editDataInput.onRowDropDownSet(Number(selection.selected));
		}));
		this.toDispose.push(attachSelectBoxStyler(this.selectBox, this._themeService));
	}
}

/**
 * Action class that is tied with toggling the Query editor
 */
export class ShowQueryPaneAction extends EditDataAction {

	private static EnabledClass = 'filterLabel';
	public static ID = 'showQueryPaneAction';
	private readonly showSqlLabel = nls.localize('editData.showSql', 'Show SQL Pane');
	private readonly closeSqlLabel = nls.localize('editData.closeSql', 'Close SQL Pane');

	constructor(editor: EditDataEditor,
		@IQueryModelService private _queryModelService: IQueryModelService,
		@IConnectionManagementService _connectionManagementService: IConnectionManagementService
	) {
		super(editor, ShowQueryPaneAction.ID, ShowQueryPaneAction.EnabledClass, _connectionManagementService);
		this.label = this.showSqlLabel;
	}

	public set queryPaneEnabled(value: boolean) {
		this.updateLabel(value);
	}

	private updateLabel(queryPaneEnabled: boolean): void {
		if (queryPaneEnabled) {
			this.label = this.closeSqlLabel;
		} else {
			this.label = this.showSqlLabel;
		}
	}

	public run(): TPromise<void> {
		this.editor.toggleQueryPane();
		this.updateLabel(this.editor.queryPaneEnabled());
		return TPromise.as(null);
	}
}