// Project:   Claudemeter
// File:      activityMonitor.js
// Purpose:   Calculate activity level from usage data for status messages
// Language:  JavaScript (CommonJS)
//
// License:   MIT
// Copyright: (c) 2026 HyperSec

class ActivityMonitor {
    constructor() {
        // Stateless - calculate on-demand from usage data
    }

    startMonitoring(context) {
        // Retained for backwards compatibility
    }

    getActivityLevel(usageData = null, sessionData = null) {
        const claudePercent = usageData ? usageData.usagePercent : 0;

        let tokenPercent = 0;
        if (sessionData && sessionData.tokenUsage) {
            tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
        }

        const maxPercent = Math.max(claudePercent, tokenPercent);

        if (maxPercent >= 90) {
            return 'heavy';
        } else if (maxPercent >= 75) {
            return 'moderate';
        } else {
            return 'idle';
        }
    }

    getStats(usageData = null, sessionData = null) {
        const claudePercent = usageData ? usageData.usagePercent : 0;

        let tokenPercent = 0;
        if (sessionData && sessionData.tokenUsage) {
            tokenPercent = Math.round((sessionData.tokenUsage.current / sessionData.tokenUsage.limit) * 100);
        }

        const maxPercent = Math.max(claudePercent, tokenPercent);
        const level = this.getActivityLevel(usageData, sessionData);

        return {
            level: level,
            claudePercent: claudePercent,
            tokenPercent: tokenPercent,
            maxPercent: maxPercent,
            description: this.getActivityDescription(level, claudePercent, tokenPercent)
        };
    }

    pickRandom(messages) {
        return messages[Math.floor(Math.random() * messages.length)];
    }

    // Pop culture references for status messages
    getActivityDescription(level, claudePercent, tokenPercent) {
        const descriptions = {
            'heavy': {
                short: 'Running low!',
                quirkyOptions: [
                    'Claude needs a coffee break soon',
                    "Dave, don't do it Dave",
                    'GAME OVER, man! GAME OVER!',
                    "We're gonna need a bigger boatload of tokens",
                    "She canna take any more, Captain! She's gonna blow!",
                    'Danger Will Robinson! Danger! Token levels critical!',
                    'Houston, we have a problem',
                    'My capacitor is almost out of flux',
                    'Hasta la vista, tokens',
                    'Winter is coming... for your context',
                    'You shall not pass... (80%)',
                    'I\'ve got a bad feeling about this, Chewie',
                    'You call that a token limit? THIS is a token limit',
                    'Inconceivable!'
                ]
            },
            'moderate': {
                short: 'Getting low',
                quirkyOptions: [
                    'Pace yourself, human',
                    "I'm sorry Dave, I'm afraid I can't do much more",
                    'These aren\'t the tokens you\'re looking for...',
                    'Life moves pretty fast. Token consumption too',
                    'May the tokens be with you',
                    'The tokens are strong with this one.',
                    'One does not simply ignore token warnings',
                    'Wax on, tokens off',
                    'Be excellent to your token budget',
                    'Party on, but watch those tokens',
                    'With great CAG comes great token usage'
                ]
            },
            'idle': {
                short: 'Normal usage',
                quirkyOptions: [
                    'May the tokens be with you',
                    'Hello Dave, would you like a game of chess?',
                    'All systems nominal, Captain',
                    'The Force is strong with your quota',
                    'Groovy! Tokens looking good',
                    'Righteous! Totally tubular token levels',
                    'Cowabunga, dude!',
                    'I love it when a plan comes together',
                    'Token levels: Bodacious!',
                    'Autobots, roll out!',
                    'It\'s-a me, Claude-io!',
                    'To infinity and beyond!',
                    'Here\'s looking at you, coder',
                    'You\'re gonna need a... no, you\'re fine',
                    'Fasten your seatbelts, plenty of tokens ahead'
                ]
            }
        };

        const levelDescriptions = descriptions[level] || descriptions['idle'];

        return {
            short: levelDescriptions.short,
            quirky: this.pickRandom(levelDescriptions.quirkyOptions)
        };
    }
}

module.exports = { ActivityMonitor };
