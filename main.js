import fetch from 'node-fetch';
import fs from 'fs';
import chalk from 'chalk';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { banner } from './utils/banner.js';
import { logger } from './utils/logger.js';
import getToken from './getToken.js';

const getRandomQuality = () => {
    return Math.floor(Math.random() * (99 - 60 + 1)) + 60;
};

const getProxies = () => {
    try {
        return fs.readFileSync('proxy.txt', 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
    } catch (error) {
        logger('No proxy.txt found or empty. Proceeding without proxies.', 'warn');
        return [];
    }
};

const getTokens = () => {
    try {
        return fs.readFileSync('token.txt', 'utf8').split('\n').map(line => line.trim()).filter(Boolean);
    } catch (error) {
        logger('No token.txt found or empty.', 'warn');
        return [];
    }
};

const shareBandwidth = async (token, proxy = null, accountIndex) => {
    const quality = getRandomQuality();
    const fetchOptions = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ quality }),
    };

    if (proxy) {
        fetchOptions.agent = new HttpsProxyAgent(proxy);
    }

    const maxRetries = 5;
    let attempt = 0;

    while (attempt < maxRetries) {
        try {
            const response = await fetch('https://api.openloop.so/bandwidth/share', fetchOptions);

            if (!response.ok) {
                throw new Error(`Failed to share bandwidth! Status: ${response.statusText}`);
            }

            const data = await response.json();

            const logBandwidthShareResponse = (response) => {
                if (response && response.data && response.data.balances) {
                    const balance = response.data.balances.POINT;
                    logger(
                        `[Account ${accountIndex}] Bandwidth shared Message: ${chalk.yellow(response.message)} | Score: ${chalk.yellow(quality)} | Total Earnings: ${chalk.yellow(balance)}`
                    );
                }
            };

            logBandwidthShareResponse(data);
            return;
        } catch (error) {
            attempt++;
            if (attempt >= maxRetries) {
                logger(`[Account ${accountIndex}] Max retries reached. Skipping.`, 'error');
            } else {
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
    }
};

let intervalId;

const checkMissions = async (token, proxy = null, accountIndex) => {
    const fetchOptions = {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };

    if (proxy) {
        fetchOptions.agent = new HttpsProxyAgent(proxy);
    }

    try {
        const response = await fetch('https://api.openloop.so/missions', fetchOptions);

        if (response.status === 401) {
            logger(`[Account ${accountIndex}] Token is expired. Trying to get a new token...`, 'warn');
            clearInterval(intervalId);

            await getToken();
            restartInterval();
            return null;
        } else if (!response.ok) {
            throw new Error(`Failed to fetch missions! Status: ${response.statusText}`);
        }

        const data = await response.json();
        return data.data;

    } catch (error) {
        logger(`[Account ${accountIndex}] Error Fetching Missions!`, 'error', error);
    }
};

const restartInterval = () => {
    intervalId = setInterval(shareBandwidthForAllTokens, 60 * 1000);
};

const shareBandwidthForAllTokens = async () => {
    const tokens = getTokens();
    const proxies = getProxies();

    if (tokens.length === 0) {
        logger('No tokens available in token.txt.', 'error');
        return;
    }

    logger(`Starting process for ${tokens.length} accounts...`, 'info');

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const proxy = proxies.length > 0 ? proxies[i % proxies.length] : null;
        const accountIndex = i + 1;

        logger(`[Account ${accountIndex}] Processing token: ${token.slice(0, 10)}...`, 'info');

        try {
            const response = await checkMissions(token, proxy, accountIndex);
            if (response && Array.isArray(response.missions)) {
                const availableMissionIds = response.missions
                    .filter(mission => mission.status === 'available')
                    .map(mission => mission.missionId);

                logger(`[Account ${accountIndex}] Available Missions: ${availableMissionIds.length}`, 'info');
                for (const missionId of availableMissionIds) {
                    logger(`[Account ${accountIndex}] Do and complete mission Id: ${missionId}`, 'info');
                    const completeMission = await doMissions(missionId, token, proxy, accountIndex);
                    logger(`[Account ${accountIndex}] Mission Id: ${missionId} Complete: ${completeMission.message}`);
                }
            }
        } catch (error) {
            logger(`[Account ${accountIndex}] Error checking missions:`, 'error', error);
        }

        try {
            await shareBandwidth(token, proxy, accountIndex);
        } catch (error) {
            logger(`[Account ${accountIndex}] Error processing token: ${token.slice(0, 10)}..., Error: ${error.message}`, 'error');
        }

        // Add delay between accounts to avoid rate limiting
        await new Promise((resolve) => setTimeout(resolve, 60000)); // 60 seconds delay
    }
};

const doMissions = async (missionId, token, proxy = null, accountIndex) => {
    const fetchOptions = {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    };

    if (proxy) {
        fetchOptions.agent = new HttpsProxyAgent(proxy);
    }

    try {
        const response = await fetch(`https://api.openloop.so/missions/${missionId}/complete`, fetchOptions);

        if (!response.ok) {
            throw new Error(`Failed to Complete Missions! Status: ${response.statusText}`);
        }

        const data = await response.json();
        return data;

    } catch (error) {
        logger(`[Account ${accountIndex}] Error Complete Missions!`, 'error', error);
    }
};

const main = () => {
    logger(banner, 'debug');
    logger('Starting bandwidth sharing each minute...');
    shareBandwidthForAllTokens();

    intervalId = setInterval(shareBandwidthForAllTokens, 60 * 1000);
};

main();
