import { strict as assert } from 'assert';

import { GitPullRequest } from 'azure-devops-node-api/interfaces/GitInterfaces';
import { createSandbox, SinonSandbox } from 'sinon';
import { createMock } from 'ts-auto-mock';
import { RefType } from '../../api/api1';
import { CredentialStore } from '../../azdo/credentials';
import { IRepository } from '../../azdo/interface';
import { PullRequestGitHelper } from '../../azdo/pullRequestGitHelper';
import { PullRequestModel } from '../../azdo/pullRequestModel';
import { convertAzdoPullRequestToRawPullRequest } from '../../azdo/utils';
import { Protocol } from '../../common/protocol';
import { Remote } from '../../common/remote';
import { MockAzdoRepository } from '../mocks/mockAzdoRepository';
import { MockCommandRegistry } from '../mocks/mockCommandRegistry';
import { createFakeSecretStorage } from '../mocks/mockExtensionContext';
import { MockRepository } from '../mocks/mockRepository';
import { MockTelemetry } from '../mocks/mockTelemetry';

describe('PullRequestGitHelper', function () {
	let sinon: SinonSandbox;
	let repository: MockRepository;
	let telemetry: MockTelemetry;
	let credentialStore: CredentialStore;

	beforeEach(function () {
		sinon = createSandbox();

		MockCommandRegistry.install(sinon);

		repository = new MockRepository();
		telemetry = new MockTelemetry();
		const secretStore = createFakeSecretStorage();
		credentialStore = new CredentialStore(telemetry, secretStore);
	});

	afterEach(function () {
		sinon.restore();
	});

	describe('checkoutFromFork', function () {
		it('fetches, checks out, and configures a branch from a fork', async function () {
			const url = 'https://aaa@dev.azure.com/aaa/bbb/you/bbb';
			const remote = new Remote('elsewhere', url, new Protocol(url));
			// const azdoRepository = sinon.mock(new AzdoRepository(remote, credentialStore, telemetry));
			// azdoRepository.expects('getBranchRef').resolves({
			// 	ref: '',
			// 	sha: '',
			// 	exist: true,
			// });

			const azdoRepository = new MockAzdoRepository(remote, credentialStore, telemetry, sinon);
			azdoRepository.getBranchRef = sinon.stub(azdoRepository, 'getBranchRef').resolves({
				ref: 'my-branch',
				sha: '',
				exists: true,
				repo: createMock<IRepository>({
					cloneUrl: 'https://dev.azure.com/aaa/bbb/you/bbb',
				}),
			});

			const prItem = await convertAzdoPullRequestToRawPullRequest(
				createMock<GitPullRequest>({
					pullRequestId: 100,
					createdBy: {
						id: '1134',
						uniqueName: 'me',
					},
					sourceRefName: 'ref/heads/my-branch',
					targetRefName: 'ref/heads/main',
				}),
				azdoRepository,
			);

			repository.expectFetch('you', 'my-branch:pr/me/100', 1);
			repository.expectPull(true);

			const pullRequest: PullRequestModel = new PullRequestModel(telemetry, azdoRepository, remote, prItem);

			if (!(pullRequest as PullRequestModel).isResolved()) {
				assert((pullRequest as PullRequestModel).isResolved(), 'pull request head not resolved successfully');
				return;
			}

			await PullRequestGitHelper.checkoutFromFork(repository, pullRequest, undefined);

			assert.deepEqual(repository.state.remotes, [
				{
					name: 'you',
					fetchUrl: 'https://dev.azure.com/aaa/bbb/you/bbb',
					pushUrl: 'https://dev.azure.com/aaa/bbb/you/bbb',
					isReadOnly: false,
				},
			]);
			assert.deepEqual(repository.state.HEAD, {
				type: RefType.Head,
				name: 'pr/me/100',
				commit: undefined,
				upstream: {
					remote: 'you',
					name: 'my-branch',
				},
			});
			assert.strictEqual(await repository.getConfig('branch.pr/me/100.github-pr-owner-number'), 'you#bbb#100');
		});
	});
});
