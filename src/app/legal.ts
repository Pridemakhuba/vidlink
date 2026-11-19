export const COMPANY = {
  name: 'Khubas IT Solution (PTY) LTD',
  reg: '2026/605418/07',
  tagline: 'Your Vision · Our Technology · Real Results',
  year: 2026,
  // Fill these in to show contact details in the footer and policies.
  email: '',
  address: '',
};

export type PolicyId = 'privacy' | 'cookies' | 'data' | 'terms';

export interface PolicySection {
  h: string;
  p?: string[];
  ul?: string[];
}

export interface Policy {
  id: PolicyId;
  title: string;
  short: string;
  updated: string;
  sections: PolicySection[];
}

const UPDATED = '18 November 2026';

export const POLICIES: Policy[] = [
  {
    id: 'privacy',
    title: 'Privacy Policy',
    short: 'Privacy',
    updated: UPDATED,
    sections: [
      {
        h: 'Who we are',
        p: [
          `AllvidLink is operated by ${COMPANY.name} (Reg. No. ${COMPANY.reg}), South Africa. We are the responsible party under the Protection of Personal Information Act 4 of 2013 (POPIA).`,
        ],
      },
      {
        h: 'What we process',
        ul: [
          'The link you paste, used only to create your file.',
          'Your IP address and basic request data, used for security and abuse prevention (for example rate limits).',
        ],
        p: ['There are no accounts, no sign-up and no tracking. We do not ask for your name or email.'],
      },
      {
        h: 'Sharing',
        p: [
          'We do not sell or share your information. Our server contacts the platform that hosts the video. The thumbnail loads from that platform, so it may see your IP address. We disclose information only when the law requires it.',
        ],
      },
      {
        h: 'Your rights',
        p: [
          'Under POPIA you may ask us what information we hold about you, and ask us to correct or delete it. You may also complain to the Information Regulator (inforegulator.org.za).',
        ],
      },
    ],
  },
  {
    id: 'cookies',
    title: 'Cookie Policy',
    short: 'Cookies',
    updated: UPDATED,
    sections: [
      {
        h: 'Essential only',
        p: [
          'We use no advertising, analytics or tracking cookies, and no third-party cookies are set through our site.',
          'We store one setting in your browser\'s local storage: that you closed the cookie notice. It never leaves your device.',
        ],
      },
      {
        h: 'Thumbnails',
        p: ['Video thumbnails load from the hosting platform, which may use its own cookies under its own policy.'],
      },
      {
        h: 'Your control',
        p: ['You can clear cookies and local storage in your browser at any time. The site will still work.'],
      },
    ],
  },
  {
    id: 'data',
    title: 'Data Use & Retention',
    short: 'Data Use',
    updated: UPDATED,
    sections: [
      {
        h: 'Processing',
        p: [
          'When you click Download, our server fetches the media from the platform and converts it if needed. The file is kept only so that you can download it.',
        ],
      },
      {
        h: 'Retention',
        ul: [
          'Files are deleted automatically within 30 minutes. Failed conversions are deleted immediately.',
          'Rate-limit records are kept in memory only, for up to 10 minutes.',
          'We keep no archive of the media or the links you convert.',
        ],
      },
      {
        h: 'Security',
        p: [
          'All traffic is encrypted (HTTPS). The server only accepts links from supported platforms and enforces strict size and duration limits. Our pages are protected by modern browser security policies.',
        ],
      },
    ],
  },
  {
    id: 'terms',
    title: 'Terms of Use',
    short: 'Terms',
    updated: UPDATED,
    sections: [
      {
        h: 'Permitted use',
        ul: [
          'Download only content you own, or content you have the rights holder\'s permission to download.',
          'You are responsible for complying with copyright law and each platform\'s terms.',
          'Do not use automated or bulk downloading, and do not try to disrupt the service.',
        ],
      },
      {
        h: 'Limits',
        p: ['Live streams and videos longer than 2 hours are not supported. Usage limits apply to keep the service fair for everyone.'],
      },
      {
        h: 'No affiliation',
        p: [
          'AllvidLink is independent. It is not affiliated with or endorsed by YouTube, Google, Meta, Facebook, Instagram or TikTok.',
        ],
      },
      {
        h: 'Liability',
        p: [
          `The service is provided "as is". To the extent the law permits, ${COMPANY.name} is not liable for any loss arising from its use, or for the content you download. All media belongs to its respective owners.`,
        ],
      },
      {
        h: 'Copyright',
        p: [
          `© ${COMPANY.year} ${COMPANY.name}. All rights reserved. These terms are governed by the laws of the Republic of South Africa.`,
        ],
      },
    ],
  },
];
