export const COMPANY = {
  name: 'Khubas IT Solution (PTY) LTD',
  reg: '2026/605418/07',
  tagline: 'Your Vision · Our Technology · Real Results',
  year: 2026,
  // Fill these in to show contact details in the footer and policies.
  email: '',
  address: '',
};

export type PolicyId = 'privacy' | 'cookies' | 'data' | 'terms' | 'disclaimer';

export interface PolicySection {
  h: string;
  p?: string[];
  ul?: string[];
}

export interface Policy {
  id: PolicyId;
  title: string;
  updated: string;
  sections: PolicySection[];
}

const UPDATED = '18 November 2026';

export const POLICIES: Policy[] = [
  {
    id: 'privacy',
    title: 'Privacy Policy',
    updated: UPDATED,
    sections: [
      {
        h: 'Who we are',
        p: [
          `AllvidLink is operated by ${COMPANY.name} (Registration No. ${COMPANY.reg}), a company registered in the Republic of South Africa. We are the responsible party for personal information processed through this website, as defined in the Protection of Personal Information Act 4 of 2013 (POPIA).`,
        ],
      },
      {
        h: 'What we collect',
        ul: [
          'The video links you paste into the converter.',
          'Technical data your browser sends with every request, such as your IP address, browser type and the time of the request. This may be recorded in server logs.',
          'Your cookie-notice choice, stored only in your own browser.',
        ],
        p: ['We do not ask for your name or email. We do not require an account, and we do not knowingly collect special personal information.'],
      },
      {
        h: 'Why we use it',
        ul: [
          'To fetch the video details and create the file you asked for.',
          'To keep the service secure, prevent abuse and fix errors.',
          'To meet our legal obligations.',
        ],
      },
      {
        h: 'Sharing',
        p: [
          'We do not sell or rent your personal information. To process a link, our server contacts the platform that hosts the video (YouTube, Facebook, Instagram or TikTok). Video thumbnails load directly from that platform, so it may see your IP address. We may disclose information when the law requires it.',
        ],
      },
      {
        h: 'Your rights',
        p: [
          'Under POPIA you may ask whether we hold personal information about you, and ask us to correct or delete it. You may also object to its processing. If you are unhappy with how we handle your information, you may complain to the Information Regulator of South Africa (inforegulator.org.za).',
        ],
      },
      {
        h: 'Changes',
        p: ['We may update this policy from time to time. The "last updated" date at the top shows when it last changed.'],
      },
    ],
  },
  {
    id: 'cookies',
    title: 'Cookie Policy',
    updated: UPDATED,
    sections: [
      {
        h: 'Our approach',
        p: [
          'AllvidLink does not use advertising, analytics or tracking cookies, and we do not allow third parties to place cookies through our site.',
        ],
      },
      {
        h: 'What we store on your device',
        ul: [
          'Cookie-notice choice (browser local storage): remembers that you closed the cookie notice so we don\'t show it again. It stays until you clear your browser data.',
        ],
        p: ['This storage is strictly necessary for the site to work as you expect. It is never sent to our server.'],
      },
      {
        h: 'Third-party content',
        p: [
          'Video thumbnails load from the platform that hosts the video. Those platforms may set or read their own cookies under their own policies. We do not control those cookies.',
        ],
      },
      {
        h: 'Managing cookies',
        p: [
          'You can block or delete cookies and local storage in your browser settings. The converter will still work, but the cookie notice will appear again.',
        ],
      },
    ],
  },
  {
    id: 'data',
    title: 'Data Use & Retention',
    updated: UPDATED,
    sections: [
      {
        h: 'How a conversion works',
        ul: [
          'You paste a link. Our server asks the hosting platform for the video details.',
          'When you click Download, our server fetches the media and converts it if needed (for example to MP3).',
          'The finished file is kept on our server only so that you can download it.',
        ],
      },
      {
        h: 'How long we keep it',
        ul: [
          'Converted files and the links that created them are deleted automatically about 1 hour after the conversion.',
          'Server logs are kept only as long as we need them for security and troubleshooting.',
        ],
      },
      {
        h: 'What we never do',
        ul: [
          'We do not build a library or archive of the media you convert.',
          'We do not link your conversions to your identity.',
          'We do not use your data for advertising or profiling.',
        ],
      },
      {
        h: 'Security',
        p: [
          'We take reasonable technical and organisational steps to protect information against loss, misuse and unauthorised access. No online service is completely secure, however.',
        ],
      },
    ],
  },
  {
    id: 'terms',
    title: 'Terms of Use',
    updated: UPDATED,
    sections: [
      {
        h: 'Acceptance',
        p: ['By using AllvidLink you agree to these terms. If you do not agree, please do not use the service.'],
      },
      {
        h: 'Permitted use',
        ul: [
          'Only download content that you own, that is licensed for download, or that you have the rights holder\'s permission to download.',
          'You are responsible for following copyright law and the terms of service of each platform.',
          'Do not use the service for illegal purposes or for automated mass downloading. Do not try to disrupt or overload it.',
        ],
      },
      {
        h: 'No affiliation',
        p: [
          'AllvidLink is an independent tool. It is not affiliated with, endorsed by or sponsored by YouTube, Google, Facebook, Instagram, Meta or TikTok. Their names are used only to describe which links the tool accepts.',
        ],
      },
      {
        h: 'Service availability',
        p: [
          'The service is provided "as is" and "as available". Platforms change often, so some links may stop working. We may change, suspend or stop the service at any time.',
        ],
      },
      {
        h: 'Limitation of liability',
        p: [
          `To the extent permitted by law, ${COMPANY.name} is not liable for any indirect or consequential loss arising from your use of the service, or for content that you download.`,
        ],
      },
      {
        h: 'Governing law',
        p: ['These terms are governed by the laws of the Republic of South Africa.'],
      },
    ],
  },
  {
    id: 'disclaimer',
    title: 'Copyright & Disclaimer',
    updated: UPDATED,
    sections: [
      {
        h: 'Content ownership',
        p: [
          'All videos and audio processed by AllvidLink belong to their respective owners. We do not host, store long-term or distribute any third-party content.',
        ],
      },
      {
        h: 'Copyright concerns',
        p: [
          'If you believe the service is being used to infringe your copyright, please contact us with details of the work. We will respond as soon as reasonably possible.',
        ],
      },
      {
        h: 'Site copyright',
        p: [
          `© ${COMPANY.year} ${COMPANY.name}. All rights reserved. The AllvidLink name, design and software may not be copied or reused without permission.`,
        ],
      },
    ],
  },
];
