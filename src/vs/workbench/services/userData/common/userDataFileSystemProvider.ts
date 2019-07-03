/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { FileSystemProviderCapabilities, FileWriteOptions, IStat, FileType, FileDeleteOptions, IWatchOptions, FileOverwriteOptions, IFileSystemProviderWithFileReadWriteCapability, IFileChange, FileChangesEvent, FileChangeType } from 'vs/platform/files/common/files';
import { IUserDataProvider, IUserDataContainerRegistry, Extensions } from 'vs/workbench/services/userData/common/userData';
import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { TernarySearchTree } from 'vs/base/common/map';
import { startsWith } from 'vs/base/common/strings';
import { Registry } from 'vs/platform/registry/common/platform';

export class UserDataFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {

	private readonly versions: Map<string, number> = new Map<string, number>();

	readonly capabilities: FileSystemProviderCapabilities = FileSystemProviderCapabilities.FileReadWrite;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private readonly _onDidChangeFile: Emitter<IFileChange[]> = this._register(new Emitter<IFileChange[]>());
	readonly onDidChangeFile: Event<IFileChange[]> = this._onDidChangeFile.event;


	constructor(
		private readonly userDataHome: URI,
		private readonly userDataProvider: IUserDataProvider
	) {
		super();
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const path = this.toPath(resource);
		if (!path) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		return this.userDataProvider.onDidChangeFile(e => {
			if (new UserDataChangesEvent(e).contains(path)) {
				this.versions.set(path, this.getOrSetVersion(path) + 1);
				this._onDidChangeFile.fire(new FileChangesEvent([{ resource, type: FileChangeType.UPDATED }]).changes);
			}
		});
	}

	async stat(resource: URI): Promise<IStat> {
		const path = this.toPath(resource);
		if (path === undefined) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		if (this.isContainer(path)) {
			return {
				type: FileType.Directory,
				ctime: 0,
				mtime: this.getOrSetVersion(path),
				size: 0
			};
		}
		const result = await this.readFile(resource);
		return {
			type: FileType.File,
			ctime: 0,
			mtime: this.getOrSetVersion(path),
			size: result.byteLength
		};
	}

	mkdir(resource: URI): Promise<void> { throw new Error('not supported'); }
	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { throw new Error('not supported'); }

	async readFile(resource: URI): Promise<Uint8Array> {
		const path = this.toPath(resource);
		if (!path) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		if (this.isContainer(path)) {
			throw new Error(`Invalid user data file ${resource}`);
		}
		return this.userDataProvider.readFile(path);
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const path = this.toPath(resource);
		if (!path) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		if (!this.isContainer(path)) {
			throw new Error(`Invalid user data container ${resource}`);
		}
		const children = await this.userDataProvider.listFiles(path);
		return children.map(c => [c, FileType.File]);
	}

	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		const path = this.toPath(resource);
		if (!path) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		if (this.isContainer(path)) {
			throw new Error(`Invalid user data file ${resource}`);
		}
		return this.userDataProvider.writeFile(path, content);
	}

	delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		const path = this.toPath(resource);
		if (!path) {
			throw new Error(`Invalid user data resource ${resource}`);
		}
		if (this.isContainer(path)) {
			throw new Error(`Invalid user data file ${resource}`);
		}
		return this.userDataProvider.deleteFile(path);
	}

	private getOrSetVersion(path: string): number {
		if (!this.versions.has(path)) {
			this.versions.set(path, 1);
		}
		return this.versions.get(path)!;
	}

	private isContainer(path: string): boolean {
		if (path === '') {
			return true; // Root
		}
		return Registry.as<IUserDataContainerRegistry>(Extensions.UserDataContainers).isContainer(path);
	}

	private toPath(resource: URI): string | undefined {
		const resourcePath = resource.toString();
		const userDataHomePath = this.userDataHome.toString();
		return startsWith(resourcePath, userDataHomePath) ? resourcePath.substr(userDataHomePath.length + 1) : undefined;
	}
}

class UserDataChangesEvent {

	private _pathsTree: TernarySearchTree<string> | undefined = undefined;

	constructor(readonly paths: string[]) { }

	private get pathsTree(): TernarySearchTree<string> {
		if (!this._pathsTree) {
			this._pathsTree = TernarySearchTree.forPaths<string>();
			for (const path of this.paths) {
				this._pathsTree.set(path, path);
			}
		}
		return this._pathsTree;
	}

	contains(pathOrSegment: string): boolean {
		return this.pathsTree.findSubstr(pathOrSegment) !== undefined;
	}

}