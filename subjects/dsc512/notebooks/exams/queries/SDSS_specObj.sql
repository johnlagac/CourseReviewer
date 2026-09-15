-- Pull spectrometer catalog in a region
SELECT 
s.specobjid,s.ra,s.dec
FROM SpecObj AS s
WHERE 
 s.ra BETWEEN 10 AND 13
 AND s.dec BETWEEN 10 AND 13