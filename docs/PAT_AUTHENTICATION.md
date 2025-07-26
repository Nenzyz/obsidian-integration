# Personal Access Token Authentication for Confluence Server

If you're getting authentication errors with Confluence Server 8.5.21, you likely need to use Personal Access Token (PAT) authentication instead of basic authentication.

## When to Use PAT Authentication

- **Confluence Server 7.9+** (including 8.5.21): Use Personal Access Token
- **Confluence Cloud**: Either method works, but API tokens are recommended
- **Older Confluence Server versions**: Use Basic Authentication

## How to Set Up PAT Authentication

### Step 1: Create a Personal Access Token in Confluence

1. In Confluence, click your avatar in the top right corner
2. Go to **Settings** > **Personal Access Tokens**
3. Click **Create Token**
4. Give your token a name (e.g., "Obsidian Plugin")
5. Optionally set an expiration date for security
6. Click **Create**
7. **Copy the token immediately** - you won't be able to see it again!

### Step 2: Configure the Plugin

1. Open Obsidian Settings
2. Go to **Community Plugins** > **Confluence Integration**
3. Toggle **Authentication Method** to enable "Use Personal Access Token"
4. Paste your Personal Access Token in the **Personal Access Token** field
5. Leave the **Atlassian Username** field as is (it's not used with PAT)

### Step 3: Test the Connection

Try publishing a test page to verify the authentication works.

## Troubleshooting

### Still Getting 401 Errors?

1. **Double-check the token**: Make sure you copied it correctly
2. **Check token permissions**: The token inherits your user permissions
3. **Verify token hasn't expired**: Check in Confluence settings
4. **Confirm Confluence version**: PAT requires Server 7.9+ or Data Center 7.9+

### Switch Back to Basic Auth

If you need to use basic authentication (for Confluence Cloud or older servers):

1. Toggle **Authentication Method** to disable "Use Personal Access Token"
2. Enter your email in **Atlassian Username**
3. Enter your API token in **Atlassian API Token**

## Security Note

Personal Access Tokens are more secure than passwords because:
- They can be revoked without changing your password
- They have the same permissions as your user account
- They can be set to expire automatically
- If compromised, only the token needs to be replaced

Store your token securely and don't share it with others.