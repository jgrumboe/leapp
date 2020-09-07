import {EventEmitter, Injectable} from '@angular/core';
import {WorkspaceService} from './workspace.service';
import {NativeService} from '../services-system/native-service';
import {ConfigurationService} from '../services-system/configuration.service';
import {FileService} from '../services-system/file.service';
import {AppService, LoggerLevel, ToastLevel} from '../services-system/app.service';
import {environment} from '../../environments/environment';
import {ExecuteServiceService} from '../services-system/execute-service.service';

@Injectable({
  providedIn: 'root'
})
export class CredentialsService extends NativeService {

  // Emitters
  public refreshCredentialsEmit: EventEmitter<{havePortrait: boolean, portrait: string}> = new EventEmitter<{havePortrait: boolean, portrait: string}>();
  public refreshReturnStatusEmit: EventEmitter<boolean> = new EventEmitter<boolean>();

  // Unique timer object and time data
  timer = null;
  startTime;

  constructor(
    private workspaceService: WorkspaceService,
    private configurationService: ConfigurationService,
    private executeService: ExecuteServiceService,
    private fileService: FileService,
    private appService: AppService) {

    super();

    this.refreshCredentialsEmit.subscribe(() => this.refreshCredentials());
    this.workspaceService.credentialEmit.subscribe(res => this.processCredentials(res));
  }

  refreshCredentials() {
    // Get all the info we need
    const workspace = this.configurationService.getDefaultWorkspaceSync();
    const session = (workspace && workspace.currentSessionList) ? workspace.currentSessionList.filter(acc => acc.active === true)[0] : undefined;

    if (session) {
      if (session.accountData.accountNumber) {
        this.awsCredentialProcess(workspace, session);
      } else if (session.accountData.subscriptionId) {
        this.azureCredentialProcess(workspace, session);
      } else {
        this.cleanCredentialProcess(workspace, session);
      }
    } else {
      this.cleanCredentialProcess(workspace, session);
    }
  }

  cleanCredentialProcess(workspace, session) {
    if (workspace && session) {

      // if there are not active sessions stop session.
      if (session.accountData.accountNumber) {
        workspace.principalAccountNumber = null;
        workspace.principalRoleName = null;
        workspace.awsCredentials = {};
        this.configurationService.updateWorkspaceSync(workspace);
      } else if (session.accountData.subscriptionId) {
        // Clean Azure Credential file
        this.cleanAzureCredentialFile();
      }

      // Stop the current timer and start date
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
        this.startTime = null;
      }
    }
  }

  azureCredentialProcess(workspace, session) {
    this.executeService.execute('az login 2>&1').subscribe(res => {
      // We can use Json in res to save account information
      this.executeService.execute(`az account set --subscription ${session.accountData.subscriptionId} 2>&1`).subscribe(acc => {
        // Set email of the user
        const azureProfile = this.configurationService.getAzureProfileSync();

        // console.log('azure', azureProfile);
        // this.workspaceService.emailEmit.emit(azureProfile.subscriptions[0].user.name);

        // Start Calculating time here once credentials are actually retrieved
        this.startTime = new Date();

        // If the timer is not set, set the unique timer object and fix the starting time
        if (this.timer === undefined || this.timer === null) {
          this.timer = setInterval(() => {
            // process time check for session
            this.processRefreshCredentials();
          }, 1000);
        }

        // Emit return credentials
        this.appService.toast('Credentials refreshed.', ToastLevel.INFO, 'Credentials');
        this.refreshReturnStatusEmit.emit(true);
      }, err2 => {

      });
    }, err => {

    });
  }

  awsCredentialProcess(workspace, session) {
    // Check for Aws Credentials Process
    if (!workspace.idpUrl) {
      return 'workspace not set';
    }
    const idpUrl = workspace.idpUrl ;

    // enable current active session
    this.fileService.writeFileSync(this.appService.awsCredentialPath(), '');
    try {

      this.workspaceService.refreshCredentials(idpUrl, session.accountData, session.roleData.name);
    } catch (e) {

      this.appService.logger(e, LoggerLevel.ERROR);
      this.refreshReturnStatusEmit.emit(false);
    }

    // Start Calculating time here once credentials are actually retrieved
    this.startTime = new Date();

    // If the timer is not set, set the unique timer object and fix the starting time
    if (this.timer === undefined || this.timer === null) {
      this.timer = setInterval(() => {
        // process time check for session
        this.processRefreshCredentials();
      }, 1000);
    }
  }

  /**
   * Process the actual refresh credential check: if we are over the sessionDuration parameters we need to refresh credentials
   */
  private processRefreshCredentials() {
    if (this.startTime) {
      const currentTime = new Date();
      const seconds = (currentTime.getTime() - this.startTime.getTime()) / 1000;
      const timeToRefresh = (seconds > environment.sessionDuration);
      if (timeToRefresh) {
        this.refreshCredentials();
      }
    }
  }

  /**
   * Method that is launched when credential are emitted by the workspace service
   * @param res - contain the status the operation
   */
  private processCredentials(res: any) {
    if (res.status === 'ok') {
      this.appService.toast('Credentials refreshed.', ToastLevel.INFO, 'Credentials');
      this.refreshReturnStatusEmit.emit(true);
      // Set start update to monitoring backend
      this.workspaceService.sendSessionUpdateToBackend(res.accountName);
    } else {
      this.appService.toast('There was a problem in generating credentials..', ToastLevel.WARN, 'Credentials');
      this.refreshReturnStatusEmit.emit(false);
    }
  }

  private cleanAzureCredentialFile() {
    // TODO: include clean Azure ACcount
  }
}
